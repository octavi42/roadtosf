import { NextResponse } from 'next/server'
import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'
import { loadCorpus, type SfEvent, type SfPerson, type SfStory, type LoreTone } from '@/lib/lore/lore-db'
import { buildCandidateSet, type CandidateSet } from '@/lib/lore/candidates'
import { buildPickerPromptParts } from '@/lib/prompts/picker'
import {
  pickerOutputSchema,
  validatePicks,
  type PickerOutput,
  type CandidateIdSets,
} from '@/lib/schemas/picker'

// POST /api/pick-lore — wires Stages 0 → 1 → 2 → 3 of LORE_SYSTEM.md §3.
//
// Body shape (LORE_SYSTEM.md §4.2):
//   {
//     episodeIndex: number,
//     flavorTags: string[],
//     stats: { hype: number, integrity: number },
//     storySoFar: string,
//     alreadyEncountered: { eventIds, peopleIds, storyIds },
//     seed: string,
//     lastEpisodeTone?: LoreTone,
//     lastChoiceLabel?: string,
//   }
//
// Response shape:
//   {
//     picks: { eventIds, peopleIds, storyIds, rationale },
//     hydrated: { events: SfEvent[], people: SfPerson[], stories: SfStory[] },
//     candidateSizes: { events, people, stories },
//     dropped: { eventIds, peopleIds, storyIds }, // hallucinated IDs (logged)
//     source: "llm" | "fallback",
//   }
//
// Failure handling (LORE_SYSTEM.md §3.4):
// - If Haiku throws / returns invalid JSON → fall back to deterministic
//   top-1 picks from the Stage-1 candidate set.
// - If the corpus is empty → return empty picks + empty hydrated arrays;
//   the caller should treat this as "no live event hook" and let
//   places.json color carry the episode.

const VALID_TONES = new Set<LoreTone>(['cynical', 'earnest', 'hype', 'absurd', 'wistful'])

interface Body {
  episodeIndex?: unknown
  flavorTags?: unknown
  stats?: unknown
  storySoFar?: unknown
  alreadyEncountered?: unknown
  seed?: unknown
  lastEpisodeTone?: unknown
  lastChoiceLabel?: unknown
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
function asTone(v: unknown): LoreTone | undefined {
  return typeof v === 'string' && VALID_TONES.has(v as LoreTone) ? (v as LoreTone) : undefined
}

function asAlreadyEncountered(v: unknown): {
  eventIds: string[]
  peopleIds: string[]
  storyIds: string[]
} {
  if (!v || typeof v !== 'object') return { eventIds: [], peopleIds: [], storyIds: [] }
  const o = v as Record<string, unknown>
  return {
    eventIds: asStringArray(o.eventIds),
    peopleIds: asStringArray(o.peopleIds),
    storyIds: asStringArray(o.storyIds),
  }
}

function buildIdSets(candidates: CandidateSet): CandidateIdSets {
  return {
    eventIds: new Set(candidates.events.map((c) => c.event.id)),
    peopleIds: new Set(candidates.people.map((c) => c.person.id)),
    storyIds: new Set(candidates.stories.map((c) => c.story.id)),
  }
}

// Stage 1 fallback: top-1 per dataset, deterministic. Used when Haiku
// fails — picks are coarser but still grounded in the player's state.
function deterministicFallback(candidates: CandidateSet): PickerOutput {
  const eventIds = candidates.events.slice(0, 1).map((c) => c.event.id)
  const peopleIds = candidates.people.slice(0, 1).map((c) => c.person.id)
  const storyIds = candidates.stories.slice(0, 1).map((c) => c.story.id)
  return {
    eventIds,
    peopleIds,
    storyIds,
    rationale: 'fallback: top deterministic pick per dataset',
  }
}

function hydrate(
  picks: { eventIds: string[]; peopleIds: string[]; storyIds: string[] },
  candidates: CandidateSet,
): { events: SfEvent[]; people: SfPerson[]; stories: SfStory[] } {
  const eventById = new Map(candidates.events.map((c) => [c.event.id, c.event]))
  const personById = new Map(candidates.people.map((c) => [c.person.id, c.person]))
  const storyById = new Map(candidates.stories.map((c) => [c.story.id, c.story]))
  return {
    events: picks.eventIds.flatMap((id) => (eventById.has(id) ? [eventById.get(id)!] : [])),
    people: picks.peopleIds.flatMap((id) => (personById.has(id) ? [personById.get(id)!] : [])),
    stories: picks.storyIds.flatMap((id) => (storyById.has(id) ? [storyById.get(id)!] : [])),
  }
}

function parsePickerRaw(raw: string): PickerOutput {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[pick-lore] JSON extraction failed. raw head:', raw.slice(0, 400))
    throw e
  }
  const result = pickerOutputSchema.safeParse(json)
  if (!result.success) {
    console.warn(
      '[pick-lore] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[pick-lore] payload was:', JSON.stringify(json).slice(0, 400))
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
  const flavorTags = asStringArray(body.flavorTags)
  const stats = {
    hype: asInt((body.stats as Record<string, unknown> | undefined)?.hype, 0),
    integrity: asInt((body.stats as Record<string, unknown> | undefined)?.integrity, 0),
  }
  const storySoFar = asString(body.storySoFar, '')
  const alreadyEncountered = asAlreadyEncountered(body.alreadyEncountered)
  const seed = asString(body.seed, '') || `pt-${Date.now().toString(36)}`
  const lastEpisodeTone = asTone(body.lastEpisodeTone)
  const lastChoiceLabel = asString(body.lastChoiceLabel, '') || undefined

  // ── Stage 0: load corpus ────────────────────────────────────────
  let corpus
  try {
    corpus = await loadCorpus()
  } catch (err) {
    console.warn('[pick-lore] corpus load failed', err)
    return NextResponse.json(
      {
        picks: { eventIds: [], peopleIds: [], storyIds: [], rationale: '' },
        hydrated: { events: [], people: [], stories: [] },
        candidateSizes: { events: 0, people: 0, stories: 0 },
        dropped: { eventIds: [], peopleIds: [], storyIds: [] },
        source: 'fallback' as const,
        warning: 'corpus_unavailable',
      },
      { status: 200 },
    )
  }

  // ── Stage 1: deterministic candidate filter ─────────────────────
  const candidates = buildCandidateSet(corpus, {
    flavorTags,
    stats,
    alreadyEncountered,
    seed,
    lastEpisodeTone,
  })

  const candidateSizes = {
    events: candidates.events.length,
    people: candidates.people.length,
    stories: candidates.stories.length,
  }

  // Empty corpus → ship empty picks (LORE_SYSTEM.md §3.4 "Empty corpus").
  if (candidateSizes.events + candidateSizes.people + candidateSizes.stories === 0) {
    return NextResponse.json({
      picks: { eventIds: [], peopleIds: [], storyIds: [], rationale: '' },
      hydrated: { events: [], people: [], stories: [] },
      candidateSizes,
      dropped: { eventIds: [], peopleIds: [], storyIds: [] },
      source: 'fallback' as const,
      warning: 'empty_corpus',
    })
  }

  const idSets = buildIdSets(candidates)

  // ── Stage 2: LLM picker (Haiku) ─────────────────────────────────
  let pickerOutput: PickerOutput | null = null
  let source: 'llm' | 'fallback' = 'fallback'

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { systemBlocks, userBlocks } = buildPickerPromptParts({
        episodeIndex,
        flavorTags,
        stats,
        storySoFar,
        alreadyEncountered,
        lastChoiceLabel,
        candidates,
      })
      pickerOutput = await completeJson(
        {
          model: MODELS.scene, // Haiku 4.5 — spec requires Haiku for the picker
          systemBlocks,
          userBlocks,
          maxTokens: 400,
          temperature: 0.4,
        },
        parsePickerRaw,
      )
      source = 'llm'
    } catch (err) {
      console.warn('[pick-lore] Haiku path failed, falling back to deterministic', err)
      pickerOutput = deterministicFallback(candidates)
      source = 'fallback'
    }
  } else {
    pickerOutput = deterministicFallback(candidates)
  }

  // ── Stage 3: server-side validation + hydration ─────────────────
  const validated = validatePicks(pickerOutput, idSets)
  const hydrated = hydrate(validated, candidates)

  if (
    validated.dropped.eventIds.length +
      validated.dropped.peopleIds.length +
      validated.dropped.storyIds.length >
    0
  ) {
    console.warn('[pick-lore] dropped hallucinated IDs', validated.dropped)
  }

  // If the LLM returned zero usable picks (e.g. all hallucinated), fall
  // back to deterministic so the caller never sees an empty pick from a
  // non-empty corpus. Better one weak pick than zero.
  if (
    source === 'llm' &&
    validated.eventIds.length === 0 &&
    validated.storyIds.length === 0
  ) {
    const fb = deterministicFallback(candidates)
    const fbValidated = validatePicks(fb, idSets)
    const fbHydrated = hydrate(fbValidated, candidates)
    return NextResponse.json({
      picks: {
        eventIds: fbValidated.eventIds,
        peopleIds: fbValidated.peopleIds,
        storyIds: fbValidated.storyIds,
        rationale: fbValidated.rationale,
      },
      hydrated: fbHydrated,
      candidateSizes,
      dropped: validated.dropped,
      source: 'fallback' as const,
      warning: 'llm_picks_unusable',
    })
  }

  return NextResponse.json({
    picks: {
      eventIds: validated.eventIds,
      peopleIds: validated.peopleIds,
      storyIds: validated.storyIds,
      rationale: validated.rationale,
    },
    hydrated,
    candidateSizes,
    dropped: validated.dropped,
    source,
  })
}
