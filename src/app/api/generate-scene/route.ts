import { NextResponse } from 'next/server'
import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'
import { sceneSchema, sanitizeScene, type ParsedScene } from '@/lib/schemas/scene'
import { arcSkeletonSchema } from '@/lib/schemas/arc'
import { buildScenePromptParts, type PriorChoiceSummary } from '@/lib/prompts/scene'
import fallbackScenes from '@/lib/fallback/scenes.json'

const AUTHORED_SCENE_COUNT = 4
const EPISODE_LENGTH = 5

type Body = {
  llmIndex?: unknown // global LLM-tail index (0..N)
  llmIndexInEpisode?: unknown // optional override; otherwise computed
  episodeIndex?: unknown
  arcSkeleton?: unknown
  storySoFar?: unknown
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
  priorChoices?: unknown // back-compat alias
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
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[generate-scene] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = sceneSchema.safeParse(json)
  if (!result.success) {
    console.warn(
      '[generate-scene] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[generate-scene] payload was:', JSON.stringify(json).slice(0, 800))
    throw result.error
  }
  return sanitizeScene(result.data)
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const llmIndex = asInt(body.llmIndex, 0)
  const computedEpisodeIndex = Math.floor(llmIndex / EPISODE_LENGTH)
  const computedInEpisode = llmIndex % EPISODE_LENGTH
  const episodeIndex = asInt(body.episodeIndex, computedEpisodeIndex)
  const llmIndexInEpisode = asInt(body.llmIndexInEpisode, computedInEpisode)

  let arcSkeleton
  try {
    arcSkeleton = arcSkeletonSchema.parse(body.arcSkeleton)
  } catch (err) {
    return NextResponse.json({ error: 'invalid arcSkeleton', detail: String(err) }, { status: 400 })
  }

  const outline =
    arcSkeleton.scenes.find((s) => s.index === llmIndexInEpisode) ?? arcSkeleton.scenes[llmIndexInEpisode]
  if (!outline) {
    return NextResponse.json({ error: `no outline for index ${llmIndexInEpisode} in episode ${episodeIndex}` }, { status: 400 })
  }

  const sceneId = AUTHORED_SCENE_COUNT + llmIndex + 1

  const promptInput = {
    episodeIndex,
    llmIndexInEpisode,
    sceneId,
    outline,
    arcSkeleton,
    storySoFar: asString(body.storySoFar, '') || undefined,
    startupName: asString(body.startupName, 'the startup'),
    startupDescription: asString(body.startupDescription, ''),
    founderPersona: asString(body.founderPersona, ''),
    stage: asString(body.stage, '') || undefined,
    team: asString(body.team, '') || undefined,
    fundingModel: asString(body.fundingModel, '') || undefined,
    targetCustomer: asString(body.targetCustomer, '') || undefined,
    concern: asString(body.concern, '') || undefined,
    flavorTags: asStringArray(body.flavorTags),
    recentChoices: asPriorChoices(body.recentChoices ?? body.priorChoices),
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
    // For fallback, modulo-cycle through the static bank if we've gone past 5
    const fbList = fallbackScenes as unknown[]
    const fb = fbList[llmIndex % fbList.length]
    if (!fb) return NextResponse.json({ error: 'no fallback scene' }, { status: 500 })
    const parsed = sanitizeScene(sceneSchema.parse(fb))
    // Patch the id to match the requested global llmIndex so the renderer
    // doesn't show duplicate scene numbers across cycled fallbacks.
    return NextResponse.json({ scene: { ...parsed, id: sceneId }, source: 'fallback' as const })
  }
}
