import { NextResponse } from 'next/server'
import { getOrCreateAnonId } from '@/lib/anon-id'
import { createPlaythrough, listPlaythroughsByEmail } from '@/lib/playthroughs'
import { readSessionEmail } from '@/lib/auth'

type Body = {
  startupName?: unknown
  startupDescription?: unknown
  selfDescription?: unknown
  flavorTags?: unknown
  introTranscript?: unknown
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string')
  return out.length > 0 ? out : []
}

export async function GET() {
  const email = await readSessionEmail()
  if (!email) {
    return NextResponse.json({ items: [] })
  }
  try {
    const items = await listPlaythroughsByEmail(email)
    return NextResponse.json({ items })
  } catch (err) {
    console.error('listPlaythroughsByEmail failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const anonId = await getOrCreateAnonId()

  try {
    const row = await createPlaythrough({
      anonId,
      startupName: asString(body.startupName) ?? null,
      startupDescription: asString(body.startupDescription) ?? null,
      selfDescription: asString(body.selfDescription) ?? null,
      flavorTags: asStringArray(body.flavorTags) ?? [],
      introTranscript: asString(body.introTranscript) ?? null,
    })
    return NextResponse.json({ id: row.id, createdAt: row.created_at }, { status: 201 })
  } catch (err) {
    console.error('createPlaythrough failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}
