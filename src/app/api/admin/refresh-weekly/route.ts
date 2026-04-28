import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { extractItemsFromHtml, safeSlug, type IngestedItem } from '@/lib/silicon-mania/ingest'
import { currentIsoWeek } from '@/lib/silicon-mania/week'

const SOURCE_URL = 'https://www.siliconmania.tv/weekly'
const REFRESH_TIMEOUT_MS = 60_000

type Body = {
  week?: unknown
  url?: unknown
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

interface UpsertCounts {
  inserted: number
  updated: number
}

async function upsertItems(
  week: string,
  items: IngestedItem[],
): Promise<UpsertCounts> {
  const sql = getSql()
  let inserted = 0
  let updated = 0
  const seen = new Set<string>()

  for (const raw of items) {
    let id = safeSlug(raw.id || raw.headline)
    if (seen.has(id)) {
      // Same slug emitted twice — disambiguate so we don't UPSERT-stomp the
      // first row. Append a short numeric suffix.
      let suffix = 2
      while (seen.has(`${id}-${suffix}`)) suffix++
      id = `${id}-${suffix}`
    }
    seen.add(id)

    const rows = (await sql`
      INSERT INTO silicon_mania_items
        (week, id, headline, summary, image_url, category, tags, people, companies, vcs)
      VALUES
        (${week}, ${id}, ${raw.headline}, ${raw.summary}, ${raw.imageUrl ?? null},
         ${raw.category ?? null}, ${raw.tags}, ${raw.people}, ${raw.companies}, ${raw.vcs})
      ON CONFLICT (week, id) DO UPDATE SET
        headline   = EXCLUDED.headline,
        summary    = EXCLUDED.summary,
        image_url  = EXCLUDED.image_url,
        category   = EXCLUDED.category,
        tags       = EXCLUDED.tags,
        people     = EXCLUDED.people,
        companies  = EXCLUDED.companies,
        vcs        = EXCLUDED.vcs
      RETURNING (xmax = 0) AS was_insert
    `) as unknown as Array<{ was_insert: boolean }>

    const wasInsert = rows[0]?.was_insert === true
    if (wasInsert) inserted++
    else updated++
  }
  return { inserted, updated }
}

export async function POST(request: Request) {
  const expected = process.env.ADMIN_INGEST_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'ADMIN_INGEST_SECRET is not configured on the server' },
      { status: 500 },
    )
  }
  const supplied = request.headers.get('x-admin-secret')
  if (!supplied || supplied !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: Body = {}
  try {
    if (request.headers.get('content-length') !== '0') {
      body = (await request.json().catch(() => ({}))) as Body
    }
  } catch {
    body = {}
  }

  const week = asString(body.week) ?? currentIsoWeek()
  const url = asString(body.url) ?? SOURCE_URL

  let html: string
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
    const res = await fetch(url, {
      // Treat the page as a snapshot; no caching beyond a single ingest.
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        // Some hosts gate plain fetches; identify ourselves as a normal UA.
        'user-agent':
          'Mozilla/5.0 (compatible; RoadToSF-Ingest/0.1; +https://www.siliconmania.tv/weekly)',
      },
    })
    clearTimeout(timer)
    if (!res.ok) {
      return NextResponse.json(
        { error: `fetch failed: ${res.status} ${res.statusText}`, url },
        { status: 502 },
      )
    }
    html = await res.text()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `fetch failed: ${msg}`, url }, { status: 502 })
  }

  let items: IngestedItem[]
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')
    const parsed = await extractItemsFromHtml(html)
    items = parsed.items
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `extraction failed: ${msg}` }, { status: 500 })
  }

  if (items.length === 0) {
    return NextResponse.json({ week, inserted: 0, updated: 0, note: 'no items extracted' })
  }

  try {
    const counts = await upsertItems(week, items)
    return NextResponse.json({ week, ...counts, total: items.length })
  } catch (err) {
    console.error('[refresh-weekly] upsert failed', err)
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `upsert failed: ${msg}` }, { status: 500 })
  }
}
