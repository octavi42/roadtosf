import { NextResponse } from 'next/server'
import { streamJsonText, arcModel, extractJsonObject } from '@/lib/anthropic'
import {
  episodePlanSchema,
  type ParsedEpisodePlan,
} from '@/lib/schemas/episode'
import {
  buildEpisodePromptParts,
  type PriorChoiceSummary,
} from '@/lib/prompts/episode'
import { selectFlavorPool } from '@/lib/silicon-mania/select'
import { getToneSpec } from '@/lib/cameos/tone'
import type { RolledCameo, ToneId, ToneSpec } from '@/lib/cameos/types'
import { selectEpisodeSeeds } from '@/lib/storylets/select'
import type {
  FundingCondition,
  SelectionState,
  StoryletState,
  TeamCondition,
} from '@/lib/storylets/types'
import fallbackEpisode from '@/lib/fallback/episode.json'
import { readAnonId } from '@/lib/anon-id'
import { readSessionEmail } from '@/lib/auth'
import {
  debitCredit,
  InsufficientCreditsError,
  REASONS,
} from '@/lib/credits'
import type { Episode } from '@/lib/types'

type Body = {
  episodeIndex?: unknown
  priorStorySoFar?: unknown
  /** The single most-recent player choice — the load-bearing input
   *  for choice-responsiveness. */
  lastChoice?: unknown
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
  currentStats?: unknown
  seed?: unknown
  /** Already-fired storylet seed ids — excluded from the seed pool. */
  firedSeedIds?: unknown
  rolledCameos?: unknown
  tone?: unknown
  playthroughId?: unknown
}

const VALID_TONES: ReadonlySet<ToneId> = new Set([
  'paranoid-thriller',
  'hype-pilled-comedy',
  'slow-burn-tragedy',
  'delusional-mania',
  'contrarian-fable',
])

function asRolledCameos(v: unknown): RolledCameo[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): RolledCameo[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    if (
      typeof o.id !== 'string' ||
      typeof o.displayName !== 'string' ||
      typeof o.archetype !== 'string' ||
      typeof o.blurb !== 'string' ||
      typeof o.rarity !== 'number'
    ) {
      return []
    }
    return [
      {
        id: o.id,
        displayName: o.displayName,
        archetype: o.archetype as RolledCameo['archetype'],
        rarity: o.rarity,
        blurb: o.blurb,
      },
    ]
  })
}

function asToneSpec(v: unknown): ToneSpec | undefined {
  if (typeof v !== 'string') return undefined
  if (!VALID_TONES.has(v as ToneId)) return undefined
  return getToneSpec(v as ToneId)
}

function asRolledCameoIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): string[] => {
    if (typeof item === 'string') return [item]
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      if (typeof o.id === 'string') return [o.id]
    }
    return []
  })
}

function classifyTeam(team?: string): TeamCondition | undefined {
  if (!team) return undefined
  const t = team.toLowerCase()
  if (/(solo|alone|just me|by myself|no co.?founder)/.test(t)) return 'solo'
  return 'named'
}

function classifyFunding(funding?: string): FundingCondition | undefined {
  if (!funding) return undefined
  const f = funding.toLowerCase()
  if (/(bootstrap|no raise|profitable|self.?funded)/.test(f))
    return 'bootstrapping'
  if (/(rais|seed|series|preseed|fund)/.test(f)) return 'raising'
  return 'unstated'
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : []
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

function asLastChoice(v: unknown): PriorChoiceSummary | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return {
    sceneId: asInt(o.sceneId, 0),
    choiceLabel: asString(o.choiceLabel, '(unspecified)'),
    hypeDelta: asInt(o.hypeDelta, 0),
    integrityDelta: asInt(o.integrityDelta, 0),
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseFromRaw(raw: string, episodeIndex: number): ParsedEpisodePlan {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn(
      '[generate-episode] JSON extraction failed. raw:',
      raw.slice(0, 800),
    )
    throw e
  }
  const result = episodePlanSchema.safeParse(json)
  if (!result.success) {
    console.warn(
      '[generate-episode] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn(
      '[generate-episode] payload was:',
      JSON.stringify(json).slice(0, 800),
    )
    throw result.error
  }
  return {
    ...result.data,
    episodeIndex: result.data.episodeIndex ?? episodeIndex,
  }
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
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
  const lastChoice = asLastChoice(body.lastChoice)
  const recentChoices = asPriorChoices(body.recentChoices)
  const flavorTags = asStringArray(body.flavorTags)
  const teamRaw = asString(body.team, '') || undefined
  const fundingRaw = asString(body.fundingModel, '') || undefined
  const firedSeedIds = asStringArray(body.firedSeedIds)
  const playthroughId =
    typeof body.playthroughId === 'string' ? body.playthroughId : null

  // Credit gate: 1 credit per episode (covers all 3-5 scenes' dialogue
  // + image gen). Debit BEFORE the LLM call so a busted balance never
  // spends Anthropic tokens.
  let creditsRemaining: number | null = null
  const [anonId, email] = await Promise.all([readAnonId(), readSessionEmail()])
  try {
    const debited = await debitCredit(
      { anonId, email },
      {
        reason: REASONS.EPISODE_DEBIT,
        playthroughId,
        episodeIndex,
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
    console.error('generate-episode: debit failed', err)
    return NextResponse.json(
      { error: 'credit debit failed' },
      { status: 500 },
    )
  }

  const siliconManiaItems = await selectFlavorPool(flavorTags, 4)

  // Build the seed pool. The legacy storyletState was used for
  // cooldown/flag bookkeeping; the new pipeline uses firedSeedIds as
  // the cross-episode cooldown only, and predicate flags fall back to
  // the empty default. (Most flag-gated storylets weren't reaching
  // their gates in the old model anyway.)
  const storyletState: StoryletState = { fired: [], flags: {} }
  const currentHype = asInt(
    (body.currentStats as Record<string, unknown> | undefined)?.hype,
    0,
  )
  const currentIntegrity = asInt(
    (body.currentStats as Record<string, unknown> | undefined)?.integrity,
    0,
  )
  const tone = asString(body.tone, '') || undefined
  const rolledCameoIds = asRolledCameoIds(body.rolledCameos)
  const selectionState: SelectionState = {
    episodeIndex,
    hype: currentHype,
    integrity: currentIntegrity,
    team: classifyTeam(teamRaw),
    funding: classifyFunding(fundingRaw),
    storyletState,
    rolledCameos: rolledCameoIds.length > 0 ? rolledCameoIds : undefined,
    tone,
    flavorTags,
    seed: asString(body.seed, '') || undefined,
  }
  const seedPool = selectEpisodeSeeds(selectionState, firedSeedIds)

  const promptInput = {
    episodeIndex,
    priorStorySoFar,
    lastChoice,
    startupName: asString(body.startupName, 'the startup'),
    startupDescription: asString(body.startupDescription, ''),
    founderPersona: asString(body.founderPersona, ''),
    stage: asString(body.stage, '') || undefined,
    team: teamRaw,
    fundingModel: fundingRaw,
    targetCustomer: asString(body.targetCustomer, '') || undefined,
    concern: asString(body.concern, '') || undefined,
    flavorTags,
    recentChoices,
    currentStats: { hype: currentHype, integrity: currentIntegrity },
    seed: asString(body.seed, '') || undefined,
    todayISO: todayISO(),
    siliconManiaItems,
    rolledCameos: asRolledCameos(body.rolledCameos),
    tone: asToneSpec(body.tone),
    seedPool,
    firedSeedIds,
  }

  const { systemBlocks, userBlocks } = buildEpisodePromptParts(promptInput)

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(name, data)))
      }

      // Trim the LLM output's seedIds to ones that actually exist in
      // templates.json. The planner is the source of truth for the
      // pick — but if it hallucinates an id, drop it rather than
      // breaking downstream cooldown bookkeeping.
      const validSeedIds = new Set(seedPool.map((s) => s.id))
      const validateSeedIds = (ids: string[]): string[] =>
        ids.filter((id) => validSeedIds.has(id))

      const sendFallback = () => {
        const parsed = episodePlanSchema.parse({
          ...fallbackEpisode,
          episodeIndex,
        })
        const ep: Episode = { ...parsed, seedIds: parsed.seedIds }
        send('done', {
          episode: ep,
          source: 'fallback' as const,
          creditsRemaining,
        })
      }

      try {
        if (!process.env.ANTHROPIC_API_KEY)
          throw new Error('ANTHROPIC_API_KEY missing')

        const raw = await streamJsonText({
          model: arcModel(),
          systemBlocks,
          userBlocks,
          // Episode JSON: theme + premise + cast (2-8 named, each with
          // a 200-300 char blurb) + scenes (3-5, each with setting,
          // cast subset, imagePrompt, topic, title) + storySoFar.
          // Real responses can hit 2200-2800 tokens. Bumping to 3200
          // leaves headroom so the response isn't truncated mid-array
          // (which yielded "expected , or ]" parse errors).
          maxTokens: 3200,
          temperature: 0.85,
          signal: request.signal,
        })

        const plan = parseFromRaw(raw, episodeIndex)
        const ep: Episode = {
          ...plan,
          seedIds: validateSeedIds(plan.seedIds ?? []),
        }
        send('done', {
          episode: ep,
          source: 'llm' as const,
          creditsRemaining,
        })
      } catch (err) {
        console.warn('generate-episode: LLM path failed, sending fallback', err)
        try {
          sendFallback()
        } catch (fallbackErr) {
          console.error(
            'generate-episode: fallback send failed',
            fallbackErr,
          )
          send('error', {
            message: 'episode-gen failed and fallback unavailable',
          })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
