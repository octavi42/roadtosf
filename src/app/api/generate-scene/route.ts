import { NextResponse } from 'next/server'
import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'
import { sceneSchema, sanitizeScene, type ParsedScene } from '@/lib/schemas/scene'
import { arcSkeletonSchema } from '@/lib/schemas/arc'
import { buildScenePromptParts, type PriorChoiceSummary } from '@/lib/prompts/scene'
import fallbackScenes from '@/lib/fallback/scenes.json'

type Body = {
  llmIndex?: unknown
  arcSkeleton?: unknown
  startupName?: unknown
  startupDescription?: unknown
  founderPersona?: unknown
  stage?: unknown
  flavorTags?: unknown
  priorChoices?: unknown
  currentStats?: unknown
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

function parseFromRaw(raw: string): ParsedScene {
  return sanitizeScene(sceneSchema.parse(extractJsonObject(raw)))
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const llmIndex = asInt(body.llmIndex, 0)

  let arcSkeleton
  try {
    arcSkeleton = arcSkeletonSchema.parse(body.arcSkeleton)
  } catch (err) {
    return NextResponse.json({ error: 'invalid arcSkeleton', detail: String(err) }, { status: 400 })
  }

  const outline = arcSkeleton.scenes.find((s) => s.index === llmIndex) ?? arcSkeleton.scenes[llmIndex]
  if (!outline) {
    return NextResponse.json({ error: `no outline for llmIndex ${llmIndex}` }, { status: 400 })
  }

  const sceneId = 5 + llmIndex + 1 // authored scenes are 1..5; LLM tail starts at 6

  const promptInput = {
    llmIndex,
    sceneId,
    outline,
    arcSkeleton,
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
  }

  const { systemBlocks, userBlocks } = buildScenePromptParts(promptInput)

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')
    const scene = await completeJson(
      { model: MODELS.scene, systemBlocks, userBlocks, maxTokens: 1000, temperature: 0.9 },
      parseFromRaw,
    )
    return NextResponse.json({ scene, source: 'llm' as const })
  } catch (err) {
    console.warn(`generate-scene index=${llmIndex}: LLM path failed, returning fallback`, err)
    const fbList = fallbackScenes as unknown[]
    const fb = fbList[llmIndex]
    if (!fb) return NextResponse.json({ error: 'no fallback scene' }, { status: 500 })
    const parsed = sanitizeScene(sceneSchema.parse(fb))
    return NextResponse.json({ scene: parsed, source: 'fallback' as const })
  }
}
