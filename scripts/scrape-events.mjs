#!/usr/bin/env node
// Scrape upcoming SF tech events from Luma + Partiful + Cerebral Valley
// public HTML, OR extract events from local screenshots via Claude vision.
// Upserts into sf_events.
//
// Sources (LORE_SYSTEM.md §2.1, public HTML / no auth):
//   - https://lu.ma/sf-tech-week
//   - https://lu.ma/sf
//   - https://cerebralvalley.ai (calendar / events page)
//   - https://partiful.com/u/<curated-host>     (added via SCRAPE_EVENTS_PARTIFUL env, comma-sep)
//
// Run (web):           npm run scrape:events
// Run (screenshots):   npm run scrape:events -- --from-screenshots references/silicon-mania/*.png
// Run (specific list): node --env-file=.env.local scripts/scrape-events.mjs --from-screenshots a.png b.png
//
// Tunables:
//   EVENTS_DRY_RUN=1            skip DB writes, just log
//   SCRAPE_EVENTS_LUMA_PATHS    comma-sep additional /sf-* paths
//   SCRAPE_EVENTS_PARTIFUL      comma-sep partiful URLs

import { readFileSync } from 'node:fs'
import { extname, basename } from 'node:path'
import { neon } from '@neondatabase/serverless'
import Anthropic from '@anthropic-ai/sdk'

const HAIKU = 'claude-haiku-4-5-20251001'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set. Add to .env.local — see .env.example.')
  process.exit(1)
}
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY not set. Add to .env.local.')
  process.exit(1)
}

const sql = neon(url)
const anthropic = new Anthropic({ apiKey })

const DRY_RUN = process.env.EVENTS_DRY_RUN === '1'

// CLI -----------------------------------------------------------------

const argv = process.argv.slice(2)
const fromScreenshotsIdx = argv.indexOf('--from-screenshots')
const fromScreenshots = fromScreenshotsIdx >= 0
const screenshotPaths = fromScreenshots ? argv.slice(fromScreenshotsIdx + 1) : []

// Sources -------------------------------------------------------------

const LUMA_PATHS = ['sf-tech-week', 'sf', ...(process.env.SCRAPE_EVENTS_LUMA_PATHS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])]
const PARTIFUL_URLS = process.env.SCRAPE_EVENTS_PARTIFUL?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
const CV_URLS = ['https://cerebralvalley.ai/events', 'https://cerebralvalley.ai/']

// Helpers -------------------------------------------------------------

function safeSlug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function compactHtml(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80_000)
}

function extractJson(raw) {
  let s = String(raw).trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('no json object')
  return JSON.parse(s.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1'))
}

// Vision + HTML extractor -------------------------------------------

const EXTRACT_SYSTEM = `You are an event-extractor for a satirical SF founder game. Pull every individual tech/startup event you can see in the input. Output JSON only.

OUTPUT SHAPE (start "{" end "}", no prose, no fences):
{
  "events": [
    {
      "name": string,                       // event title
      "venue": string,                      // venue name; "" if not visible
      "host": string,                       // host or organizer; "" if not visible
      "start_at": string,                   // ISO 8601 timestamp WITH timezone if knowable, else date YYYY-MM-DD; "" if unknown
      "url": string,                        // direct link if visible, else ""
      "blurb": string,                      // 1-2 sentence vibe (≤220 chars)
      "tags": string[]                      // 2-5 lowercase kebab-case tags
    }
  ]
}

TAG VOCAB (prefer these): ai, hype, partying, fundraising, founder, vc, recruiting, community, product, press, crypto, demo, hackathon, mixer, panel, dinner, recovery.

RULES:
- Each event must be a SEPARATE object. Never merge two events.
- "blurb" is your retelling — short, opinionated, comic. Never paste the description verbatim.
- Real names of people / venues stay verbatim.
- If a date is missing or unparseable, set start_at to "".
- Skip non-events (newsletters, generic CTAs, "follow us" cards).`

async function extractFromText(label, text) {
  if (!text || text.length < 200) {
    console.warn(`${label}: too little text, skipping`)
    return []
  }
  const userBlock = `## SOURCE LABEL
${label}

## SOURCE HTML
${text}

Extract every visible event. Output the JSON object now.`

  const resp = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 6000,
    temperature: 0,
    system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: userBlock }] }],
  })
  const block = resp.content.find((b) => b.type === 'text')
  if (!block) throw new Error('no text block')
  const json = extractJson(block.text)
  return Array.isArray(json.events) ? json.events : []
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

async function extractFromImage(label, imagePath) {
  const ext = extname(imagePath).toLowerCase()
  const mime = MIME_BY_EXT[ext]
  if (!mime) throw new Error(`unsupported image type: ${ext}`)
  const data = readFileSync(imagePath).toString('base64')
  const userBlock = `## SOURCE LABEL
${label} (screenshot: ${basename(imagePath)})

The attached image is a screenshot of an SF tech-event listing. Extract every event. Output the JSON object now.`

  const resp = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 4000,
    temperature: 0,
    system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data } },
          { type: 'text', text: userBlock },
        ],
      },
    ],
  })
  const block = resp.content.find((b) => b.type === 'text')
  if (!block) throw new Error('no text block')
  const json = extractJson(block.text)
  return Array.isArray(json.events) ? json.events : []
}

// Web fetch -----------------------------------------------------------

async function fetchHtml(u) {
  try {
    const res = await fetch(u, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 roadtosf-lore-bot/0.1',
        'accept': 'text/html,*/*',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      console.warn(`fetch ${u}: HTTP ${res.status}`)
      return null
    }
    return compactHtml(await res.text())
  } catch (e) {
    console.warn(`fetch ${u}: ${e.message}`)
    return null
  }
}

// Normalize and upsert -----------------------------------------------

function normalize(e, sourceLabel) {
  const name = String(e.name ?? '').trim()
  if (!name) return null
  const startAtRaw = String(e.start_at ?? '').trim()
  let startAt = null
  if (startAtRaw) {
    const t = Date.parse(startAtRaw)
    if (!Number.isNaN(t)) startAt = new Date(t).toISOString()
  }
  if (!startAt) {
    // Hide events with no parseable date — they fail the "next 7d" filter
    // anyway and pollute the corpus.
    return null
  }
  const dateSlug = startAt.slice(0, 10)
  const id = `${safeSlug(sourceLabel)}-${dateSlug}-${safeSlug(name)}`.slice(0, 120)
  const tags = Array.isArray(e.tags)
    ? [...new Set(e.tags.map((t) => String(t).toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 8)
    : []
  let blurb = String(e.blurb ?? '').replace(/\s+/g, ' ').trim()
  if (blurb.length > 240) blurb = blurb.slice(0, 237) + '…'
  return {
    id,
    name,
    venue: String(e.venue ?? '').trim(),
    host: String(e.host ?? '').trim() || null,
    start_at: startAt,
    url: String(e.url ?? '').trim() || null,
    blurb,
    tags,
  }
}

async function upsert(rows) {
  let inserted = 0
  let updated = 0
  for (const r of rows) {
    if (DRY_RUN) {
      console.log(`(dry) ${r.id} | ${r.start_at} | ${r.name} @ ${r.venue}`)
      inserted++
      continue
    }
    const before = await sql`SELECT 1 FROM sf_events WHERE id = ${r.id}`
    const isNew = before.length === 0
    await sql`
      INSERT INTO sf_events (id, name, venue, start_at, host, url, blurb, known_attendees, tags, scraped_at)
      VALUES (${r.id}, ${r.name}, ${r.venue}, ${r.start_at}, ${r.host}, ${r.url}, ${r.blurb}, ${[]}, ${r.tags}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        venue = EXCLUDED.venue,
        start_at = EXCLUDED.start_at,
        host = EXCLUDED.host,
        url = EXCLUDED.url,
        blurb = EXCLUDED.blurb,
        tags = EXCLUDED.tags,
        scraped_at = NOW()
    `
    if (isNew) inserted++
    else updated++
  }
  return { inserted, updated }
}

// Main ----------------------------------------------------------------

async function main() {
  const all = []

  if (fromScreenshots) {
    if (screenshotPaths.length === 0) {
      console.error('--from-screenshots requires at least one path')
      process.exit(1)
    }
    console.log(`extracting from ${screenshotPaths.length} screenshot(s)…`)
    for (const p of screenshotPaths) {
      try {
        const events = await extractFromImage('silicon-mania', p)
        console.log(`  ${basename(p)}: ${events.length} events`)
        for (const e of events) {
          const n = normalize(e, 'silicon-mania')
          if (n) all.push(n)
        }
      } catch (e) {
        console.warn(`screenshot ${p}: ${e.message}`)
      }
    }
  } else {
    console.log('scraping web sources…')
    for (const path of LUMA_PATHS) {
      const u = `https://lu.ma/${path}`
      const html = await fetchHtml(u)
      if (!html) continue
      try {
        const events = await extractFromText(`luma:${path}`, html)
        console.log(`  ${u}: ${events.length} events`)
        for (const e of events) {
          const n = normalize(e, `luma-${path}`)
          if (n) all.push(n)
        }
      } catch (e) {
        console.warn(`luma ${path}: ${e.message}`)
      }
    }
    for (const u of PARTIFUL_URLS) {
      const html = await fetchHtml(u)
      if (!html) continue
      try {
        const events = await extractFromText(`partiful:${u}`, html)
        console.log(`  ${u}: ${events.length} events`)
        for (const e of events) {
          const n = normalize(e, 'partiful')
          if (n) all.push(n)
        }
      } catch (e) {
        console.warn(`partiful ${u}: ${e.message}`)
      }
    }
    for (const u of CV_URLS) {
      const html = await fetchHtml(u)
      if (!html) continue
      try {
        const events = await extractFromText(`cerebralvalley:${u}`, html)
        console.log(`  ${u}: ${events.length} events`)
        for (const e of events) {
          const n = normalize(e, 'cerebralvalley')
          if (n) all.push(n)
        }
      } catch (e) {
        console.warn(`cerebralvalley ${u}: ${e.message}`)
      }
    }
  }

  // Dedupe by id (last write wins).
  const dedup = new Map()
  for (const r of all) dedup.set(r.id, r)
  const rows = [...dedup.values()]
  console.log(`upserting ${rows.length} events${DRY_RUN ? ' (dry run)' : ''}…`)
  const { inserted, updated } = await upsert(rows)
  console.log(`sf_events: ${inserted} inserted, ${updated} updated`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
