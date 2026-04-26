import { NextResponse, type NextRequest } from 'next/server'
import { logSceneEvent } from '@/lib/playthroughs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = {
  sceneNumber?: unknown
  dialogue?: unknown
  choicesShown?: unknown
  choicePicked?: unknown
  freeText?: unknown
  wasTimeout?: unknown
  timeToChooseMs?: unknown
  statDeltas?: unknown
  tonalFlag?: unknown
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function asInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined
}

function asStatDeltas(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val
  }
  return out
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const sceneNumber = asInt(body.sceneNumber)
  if (sceneNumber === undefined || sceneNumber < 1) {
    return NextResponse.json({ error: 'sceneNumber required' }, { status: 400 })
  }

  try {
    const row = await logSceneEvent({
      playthroughId: id,
      sceneNumber,
      dialogue: asString(body.dialogue) ?? null,
      choicesShown: Array.isArray(body.choicesShown) ? body.choicesShown : [],
      choicePicked: asString(body.choicePicked) ?? null,
      freeText: asString(body.freeText) ?? null,
      wasTimeout: body.wasTimeout === true,
      timeToChooseMs: asInt(body.timeToChooseMs) ?? null,
      statDeltas: asStatDeltas(body.statDeltas) ?? {},
      tonalFlag: asString(body.tonalFlag) ?? null,
    })
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (err) {
    console.error('logSceneEvent failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}
