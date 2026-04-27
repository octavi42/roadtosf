import { NextResponse } from 'next/server'
import { completeJson } from '@/lib/anthropic'
import { groupSchema, sanitizeGroup, type ParsedGroup } from '@/lib/schemas/group'
import { buildGroupPrompt, type PriorChoice } from '@/lib/prompts/group'
import fallback1 from '@/lib/fallback-groups/group-1.json'
import fallback2 from '@/lib/fallback-groups/group-2.json'
import fallback3 from '@/lib/fallback-groups/group-3.json'

const FALLBACKS: Record<number, unknown> = {
  1: fallback1,
  2: fallback2,
  3: fallback3,
}

type Body = {
  groupIndex?: unknown
  startupName?: unknown
  startupDescription?: unknown
  founderPersona?: unknown
  flavorTags?: unknown
  priorChoices?: unknown
  storySoFar?: unknown
  currentStats?: unknown
  seed?: unknown
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function asPriorChoices(v: unknown): PriorChoice[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): PriorChoice[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    const groupIndex = asInt(o.groupIndex, NaN)
    const sceneId = asInt(o.sceneId, NaN)
    if (Number.isNaN(groupIndex) || Number.isNaN(sceneId)) return []
    return [
      {
        groupIndex,
        sceneId,
        choiceLabel: asString(o.choiceLabel, '(unspecified)'),
        hypeDelta: asInt(o.hypeDelta, 0),
        integrityDelta: asInt(o.integrityDelta, 0),
      },
    ]
  })
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseFromRaw(raw: string): ParsedGroup {
  // Strip a trailing prose tail if any: take from first { to last }.
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON object found in response')
  const json = JSON.parse(raw.slice(start, end + 1))
  const parsed = groupSchema.parse(json)
  return sanitizeGroup(parsed)
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const groupIndex = asInt(body.groupIndex, 1)
  if (groupIndex < 1 || groupIndex > 3) {
    return NextResponse.json({ error: 'groupIndex must be 1, 2, or 3' }, { status: 400 })
  }

  const promptInput = {
    groupIndex,
    startupName: asString(body.startupName, 'Wagr'),
    startupDescription: asString(body.startupDescription, 'Venmo for sports bets between friends'),
    founderPersona: asString(body.founderPersona, ''),
    flavorTags: asStringArray(body.flavorTags),
    priorChoices: asPriorChoices(body.priorChoices),
    storySoFar: asString(body.storySoFar, '') || undefined,
    currentStats: {
      hype: asInt((body.currentStats as Record<string, unknown> | undefined)?.hype, 0),
      integrity: asInt(
        (body.currentStats as Record<string, unknown> | undefined)?.integrity,
        0,
      ),
    },
    seed: asString(body.seed, '') || undefined,
    todayISO: todayISO(),
  }

  const { system, user } = buildGroupPrompt(promptInput)

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY missing — using fallback')
    }
    const group = await completeJson({ system, user }, parseFromRaw)
    return NextResponse.json({ group, source: 'llm' as const })
  } catch (err) {
    console.warn(`generate-group ${groupIndex}: LLM path failed, returning fallback`, err)
    const fb = FALLBACKS[groupIndex]
    if (!fb) {
      return NextResponse.json({ error: 'no fallback available' }, { status: 500 })
    }
    // Validate the fallback so any drift in JSON files is caught at request time.
    const parsed = groupSchema.parse(fb)
    return NextResponse.json({ group: sanitizeGroup(parsed), source: 'fallback' })
  }
}
