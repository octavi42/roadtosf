import { streamJsonText, arcModel, extractJsonObject } from '@/lib/anthropic'
import {
  arcSkeletonSchema,
  sceneOutlineSchema,
  type ParsedArcSkeleton,
} from '@/lib/schemas/arc'
import { buildArcPromptParts, type PriorChoiceSummary } from '@/lib/prompts/arc'
import { selectFlavorPool } from '@/lib/silicon-mania/select'
import { getToneSpec } from '@/lib/cameos/tone'
import type { RolledCameo, ToneId, ToneSpec } from '@/lib/cameos/types'
import { selectEpisodeStorylets } from '@/lib/storylets/select'
import type {
  FundingCondition,
  SelectionState,
  StoryletState,
  TeamCondition,
} from '@/lib/storylets/types'
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
  // Storylet engine state — fired list + flags carried across episodes.
  // Required input: the engine refuses to pick if it doesn't know what
  // already fired (cooldowns + cross-episode flag gates depend on it).
  storyletState?: unknown
  // Composition with PR #23 (cameo + tone). Optional: storylet
  // requires that reference these gracefully evaluate false when
  // missing, so this route works whether or not #23 has shipped.
  rolledCameos?: unknown
  tone?: unknown
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

function asStoryletState(v: unknown): StoryletState {
  if (!v || typeof v !== 'object') return { fired: [], flags: {} }
  const o = v as Record<string, unknown>
  const fired = Array.isArray(o.fired)
    ? o.fired.flatMap((entry): { id: string; firedAtEpisode: number }[] => {
        if (!entry || typeof entry !== 'object') return []
        const e = entry as Record<string, unknown>
        if (typeof e.id !== 'string') return []
        const ep = typeof e.firedAtEpisode === 'number' ? e.firedAtEpisode : 0
        return [{ id: e.id, firedAtEpisode: ep }]
      })
    : []
  const flags: Record<string, boolean> = {}
  if (o.flags && typeof o.flags === 'object') {
    for (const [k, val] of Object.entries(o.flags as Record<string, unknown>)) {
      if (typeof val === 'boolean') flags[k] = val
    }
  }
  return { fired, flags }
}

// Same input as asRolledCameos but returns just the cameo ids — the
// shape the storylet selector reads. PR #23's full RolledCameo objects
// are still needed for the arc prompt; this lighter version is for
// the predicate evaluator. Both helpers coexist intentionally.
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
  if (/(bootstrap|no raise|profitable|self.?funded)/.test(f)) return 'bootstrapping'
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

function parseFromRaw(raw: string, episodeIndex: number): ParsedArcSkeleton {
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
  // Backfill episodeIndex from request if the model omitted it.
  return { ...result.data, episodeIndex: result.data.episodeIndex ?? episodeIndex }
}

// Locates `"scenes" : [` in the streamed text and returns the index *after*
// the opening bracket. Returns -1 if not yet present.
function findScenesArrayStart(text: string): number {
  const m = text.match(/"scenes"\s*:\s*\[/)
  if (!m || m.index === undefined) return -1
  return m.index + m[0].length
}

// Walks `s` from `start`, skipping commas/whitespace, and returns the next
// complete `{...}` object as parsed JSON plus the index just past it.
// Returns null if there is no complete object yet (still streaming) or if
// the array is closing (next non-ws char is `]`).
function nextCompleteObject(
  s: string,
  start: number,
): { value: unknown; end: number } | null {
  let i = start
  while (i < s.length && (s[i] === ',' || /\s/.test(s[i]!))) i++
  if (i >= s.length) return null
  if (s[i] === ']') return null
  if (s[i] !== '{') return null

  let depth = 0
  let inString = false
  let escape = false
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const slice = s.slice(i, j + 1)
        try {
          return { value: JSON.parse(slice), end: j + 1 }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const episodeIndex = asInt(body.episodeIndex, 0)
  const priorStorySoFar = asString(body.priorStorySoFar, '') || undefined
  const recentChoices = asPriorChoices(body.recentChoices ?? body.priorChoices)
  const flavorTags = asStringArray(body.flavorTags)
  const teamRaw = asString(body.team, '') || undefined
  const fundingRaw = asString(body.fundingModel, '') || undefined

  // Pull real-world SF news for this week. selectFlavorPool swallows DB
  // errors and returns [] — the arc-gen prompt then runs unmodified.
  const siliconManiaItems = await selectFlavorPool(flavorTags, 4)

  // --- Storylet selection (the planner) ---------------------------------
  // The engine picks 5 storylets BEFORE the LLM call. Sonnet's job is to
  // render them, not to invent them. See STORYLETS.md.
  const storyletState = asStoryletState(body.storyletState)
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
  }
  const { storylets: chosenStorylets, finalState: nextStoryletState } =
    selectEpisodeStorylets(selectionState)

  const promptInput = {
    episodeIndex,
    priorStorySoFar,
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
    chosenStorylets,
  }

  const { systemBlocks, userBlocks } = buildArcPromptParts(promptInput)

  const encoder = new TextEncoder()
  const poolSize = siliconManiaItems.length

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(name, data)))
      }

      const sendFallback = () => {
        const parsed = arcSkeletonSchema.parse({ ...fallbackArc, episodeIndex })
        // Replay fallback scenes as `scene` events so the client treats this
        // path identically to a successful stream.
        for (const outline of parsed.scenes) {
          send('scene', { outline })
        }
        send('done', {
          skeleton: parsed,
          source: 'fallback' as const,
          siliconManiaPoolSize: poolSize,
          storyletState: nextStoryletState,
          chosenStoryletIds: chosenStorylets.map((s) => s.id),
        })
      }

      try {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')

        let scenesStart = -1
        let nextSearchPos = 0
        let emittedCount = 0

        const tryEmitScenes = (full: string) => {
          if (scenesStart === -1) {
            scenesStart = findScenesArrayStart(full)
            if (scenesStart === -1) return
            nextSearchPos = scenesStart
          }
          while (emittedCount < 5) {
            const result = nextCompleteObject(full, nextSearchPos)
            if (!result) break
            nextSearchPos = result.end
            emittedCount++
            const parsed = sceneOutlineSchema.safeParse(result.value)
            if (parsed.success) {
              // Engine is authoritative for archetype + kind. Override the
              // LLM's emitted values with the chosen storylet's truth so a
              // hallucinated archetype or a missing `kind` field can't
              // leak downstream and cause the wrong rendering mode.
              const chosen = chosenStorylets[parsed.data.index]
              const enriched = chosen
                ? {
                    ...parsed.data,
                    archetype: chosen.archetype,
                    kind: chosen.kind ?? 'encounter',
                  }
                : parsed.data
              send('scene', { outline: enriched })
            } else {
              // Don't fail the stream — the final whole-arc validation will
              // catch it and we'll fall back. Until then, keep streaming.
              console.warn(
                '[generate-arc] streaming outline failed schema; skipping mid-stream',
                parsed.error.issues,
              )
            }
          }
        }

        const raw = await streamJsonText({
          model: arcModel(),
          systemBlocks,
          userBlocks,
          maxTokens: 1500,
          temperature: 0.85,
          onText: (_delta, full) => tryEmitScenes(full),
          signal: request.signal,
        })

        const skeleton = parseFromRaw(raw, episodeIndex)
        // Engine-authoritative pass: overwrite each scene's archetype +
        // kind with the chosen storylet's truth. The LLM is good at
        // beats and prose; we don't trust it with structural metadata.
        skeleton.scenes = skeleton.scenes.map((s) => {
          const chosen = chosenStorylets[s.index]
          return chosen
            ? { ...s, archetype: chosen.archetype, kind: chosen.kind ?? 'encounter' }
            : s
        })
        send('done', {
          skeleton,
          source: 'llm' as const,
          siliconManiaPoolSize: poolSize,
          storyletState: nextStoryletState,
          chosenStoryletIds: chosenStorylets.map((s) => s.id),
        })
      } catch (err) {
        console.warn('generate-arc: stream path failed, sending fallback', err)
        try {
          sendFallback()
        } catch (fallbackErr) {
          console.error('generate-arc: fallback send failed', fallbackErr)
          send('error', { message: 'arc-gen failed and fallback unavailable' })
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
