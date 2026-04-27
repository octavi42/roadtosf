import { NextResponse } from 'next/server'
import { completeJson, arcModel, extractJsonObject } from '@/lib/anthropic'
import { arcSkeletonSchema, type ParsedArcSkeleton } from '@/lib/schemas/arc'
import { buildArcPromptParts, type PriorChoiceSummary } from '@/lib/prompts/arc'
import fallbackArc from '@/lib/fallback/arc.json'

type Body = {
  episodeIndex?: unknown
  priorStorySoFar?: unknown
  startupName?: unknown
  startupDescription?: unknown
  founderPersona?: unknown
  stage?: unknown
  team?: unknown
  fundingModel?: unknown
  targetCustomer?: unknown
  concern?: unknown
  flavorTags?: unknown
  recentChoices?: unknown
  // Back-compat alias used by an earlier client; treated the same as recentChoices.
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
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[generate-arc] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = arcSkeletonSchema.safeParse(json)
  if (!result.success) {
    console.warn(
      '[generate-arc] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[generate-arc] payload was:', JSON.stringify(json).slice(0, 800))
    throw result.error
  }
  return result.data
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const episodeIndex = asInt(body.episodeIndex, 0)
  const priorStorySoFar = asString(body.priorStorySoFar, '') || undefined
  const recentChoices = asPriorChoices(body.recentChoices ?? body.priorChoices)

  const promptInput = {
    episodeIndex,
    priorStorySoFar,
    startupName: asString(body.startupName, 'the startup'),
    startupDescription: asString(body.startupDescription, ''),
    founderPersona: asString(body.founderPersona, ''),
    stage: asString(body.stage, '') || undefined,
    team: asString(body.team, '') || undefined,
    fundingModel: asString(body.fundingModel, '') || undefined,
    targetCustomer: asString(body.targetCustomer, '') || undefined,
    concern: asString(body.concern, '') || undefined,
    flavorTags: asStringArray(body.flavorTags),
    recentChoices,
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
      { model: arcModel(), systemBlocks, userBlocks, maxTokens: 1500, temperature: 0.85 },
      parseFromRaw,
    )
    // The model may omit episodeIndex; backfill from request so the client can trust it.
    return NextResponse.json({
      skeleton: { ...skeleton, episodeIndex: skeleton.episodeIndex ?? episodeIndex },
      source: 'llm' as const,
    })
  } catch (err) {
    console.warn('generate-arc: LLM path failed, returning fallback', err)
    const parsed = arcSkeletonSchema.parse({ ...fallbackArc, episodeIndex })
    return NextResponse.json({ skeleton: parsed, source: 'fallback' as const })
  }
}
