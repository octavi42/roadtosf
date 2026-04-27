import { NextResponse } from 'next/server'
import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'
import { arcSkeletonSchema, type ParsedArcSkeleton } from '@/lib/schemas/arc'
import { buildArcPromptParts, type PriorChoiceSummary } from '@/lib/prompts/arc'
import fallbackArc from '@/lib/fallback/arc.json'

type Body = {
  startupName?: unknown
  startupDescription?: unknown
  founderPersona?: unknown
  stage?: unknown
  flavorTags?: unknown
  priorChoices?: unknown
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

function asPriorChoices(v: unknown): PriorChoiceSummary[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): PriorChoiceSummary[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    const sceneId = asInt(o.sceneId, NaN)
    if (Number.isNaN(sceneId)) return []
    return [
      {
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

function parseFromRaw(raw: string): ParsedArcSkeleton {
  return arcSkeletonSchema.parse(extractJsonObject(raw))
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const promptInput = {
    startupName: asString(body.startupName, 'the startup'),
    startupDescription: asString(body.startupDescription, ''),
    founderPersona: asString(body.founderPersona, ''),
    stage: asString(body.stage, '') || undefined,
    flavorTags: asStringArray(body.flavorTags),
    priorChoices: asPriorChoices(body.priorChoices),
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

  const { systemBlocks, userBlocks } = buildArcPromptParts(promptInput)

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')
    const skeleton = await completeJson(
      { model: MODELS.arc, systemBlocks, userBlocks, maxTokens: 1200, temperature: 0.85 },
      parseFromRaw,
    )
    return NextResponse.json({ skeleton, source: 'llm' as const })
  } catch (err) {
    console.warn('generate-arc: LLM path failed, returning fallback', err)
    const parsed = arcSkeletonSchema.parse(fallbackArc)
    return NextResponse.json({ skeleton: parsed, source: 'fallback' as const })
  }
}
