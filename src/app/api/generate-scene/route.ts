import { NextResponse } from 'next/server'
import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'
import {
  coerceRawSceneJson,
  sceneSchema,
  sanitizeScene,
  type ParsedScene,
} from '@/lib/schemas/scene'
import { arcSkeletonSchema } from '@/lib/schemas/arc'
import { buildScenePromptParts, type PriorChoiceSummary } from '@/lib/prompts/scene'
import type { Archetype } from '@/lib/types'
import fallbackScenes from '@/lib/fallback/scenes.json'
import { readAnonId } from '@/lib/anon-id'
import { readSessionEmail } from '@/lib/auth'
import {
  debitCredit,
  getBalance,
  InsufficientCreditsError,
  REASONS,
} from '@/lib/credits'

// Mirrors client-side constants in src/lib/session.ts.
const AUTHORED_SCENE_COUNT = 8
const SCENES_PER_GROUP = 4
const GROUPS_PER_EPISODE = 5
const EPISODE_LENGTH = SCENES_PER_GROUP * GROUPS_PER_EPISODE // 20

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
  // Optional: routed through to the credit_ledger row created on debit so
  // we can answer "which playthrough burned this credit?" later.
  playthroughId?: unknown
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

function parseFromRaw(raw: string, assignedArchetype: Archetype): ParsedScene {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[generate-scene] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = sceneSchema.safeParse(coerceRawSceneJson(json, { assignedArchetype }))
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
  // Within an episode, scenes are organized into archetype groups of
  // SCENES_PER_GROUP sub-scenes each. The arc skeleton has one outline per
  // group, indexed 0..GROUPS_PER_EPISODE-1.
  const groupIndex = Math.floor(llmIndexInEpisode / SCENES_PER_GROUP)
  const subSceneIndex = llmIndexInEpisode % SCENES_PER_GROUP

  let arcSkeleton
  try {
    arcSkeleton = arcSkeletonSchema.parse(body.arcSkeleton)
  } catch (err) {
    return NextResponse.json({ error: 'invalid arcSkeleton', detail: String(err) }, { status: 400 })
  }

  const outline =
    arcSkeleton.scenes.find((s) => s.index === groupIndex) ?? arcSkeleton.scenes[groupIndex]
  if (!outline) {
    return NextResponse.json({ error: `no outline for group ${groupIndex} (sub ${subSceneIndex}) in episode ${episodeIndex}` }, { status: 400 })
  }

  const sceneId = AUTHORED_SCENE_COUNT + llmIndex + 1

  // 1 credit per LLM-generated group of SCENES_PER_GROUP sub-scenes. We
  // debit on the leader (sub-scene 0); the other 3 sub-scenes ride free on
  // the same credit. Doing this before the LLM call means a busted balance
  // never spends Anthropic tokens. The 3 followers can still arrive at the
  // server in parallel before the leader's debit fires — we accept that
  // small ($0.30) leak because the client also pre-checks balance via
  // /api/credits/balance, which makes the leak a rare race rather than the
  // common path.
  const playthroughId =
    typeof body.playthroughId === 'string' ? body.playthroughId : null
  let creditsRemaining: number | null = null
  if (subSceneIndex === 0) {
    const [anonId, email] = await Promise.all([
      readAnonId(),
      readSessionEmail(),
    ])
    try {
      const debited = await debitCredit(
        { anonId, email },
        {
          reason: REASONS.GROUP_DEBIT,
          playthroughId,
          episodeIndex,
          groupIndex,
          llmIndex,
        },
      )
      creditsRemaining = debited.remaining
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json(
          {
            error: 'insufficient_credits',
            paywall: true,
            creditsRemaining: err.balance,
          },
          { status: 402 },
        )
      }
      console.error('generate-scene: debit failed', err)
      return NextResponse.json(
        { error: 'credit debit failed' },
        { status: 500 },
      )
    }
  } else {
    // For sub-scenes 1..3, surface the current balance so the client display
    // stays in sync without a separate /api/credits/balance round-trip.
    const [anonId, email] = await Promise.all([
      readAnonId(),
      readSessionEmail(),
    ])
    try {
      creditsRemaining = await getBalance({ anonId, email })
    } catch (err) {
      console.error('generate-scene: getBalance failed (non-fatal)', err)
    }
  }

  const promptInput = {
    episodeIndex,
    llmIndexInEpisode,
    groupIndex,
    subSceneIndex,
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
      (raw) => parseFromRaw(raw, outline.archetype),
    )
    return NextResponse.json({
      scene,
      source: 'llm' as const,
      creditsRemaining,
    })
  } catch (err) {
    console.warn(`generate-scene index=${llmIndex}: LLM path failed, returning fallback`, err)
    // For fallback, modulo-cycle through the static bank if we've gone past 5
    const fbList = fallbackScenes as unknown[]
    const fb = fbList[llmIndex % fbList.length]
    if (!fb) return NextResponse.json({ error: 'no fallback scene' }, { status: 500 })
    const parsed = sanitizeScene(sceneSchema.parse(fb))
    // Patch the id to match the requested global llmIndex so the renderer
    // doesn't show duplicate scene numbers across cycled fallbacks.
    return NextResponse.json({
      scene: { ...parsed, id: sceneId },
      source: 'fallback' as const,
      creditsRemaining,
    })
  }
}
