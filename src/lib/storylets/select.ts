import templatesData from './templates.json'
import { evaluateRequires } from './predicate'
import { pickAnecdotesForStorylet } from '../anecdotes/select'
import type { Archetype } from '../types'
import type {
  ChosenStorylet,
  EpisodeShape,
  FiredStorylet,
  SelectionState,
  Storylet,
  StoryletState,
  StoryletTier,
} from './types'

const TEMPLATES = templatesData as unknown as Storylet[]
const SCENES_PER_EPISODE = 5
const DEFAULT_COOLDOWN = 2

// Tier gates: which tiers are eligible at a given episode index. Early
// runs lean on 'early' storylets; later episodes unlock the 'mid' and
// 'late' bag, so the *menu* grows as the player plays. We softened the
// hard gates here (mid: was ep>=1, late: was ep>=3) because every
// episode-0 looked the same — only early storylets eligible meant the
// same 5 beats kept winning the salience tiebreak. Mid is now eligible
// from ep 0 but pays a soft salience penalty (see saliencyScore); late
// opens at ep 2 instead of ep 3 so the rare beats actually get to fire
// in the typical 5-6 episode run.
function tierEligibleAtEpisode(tier: StoryletTier, episodeIndex: number): boolean {
  if (tier === 'early') return true
  if (tier === 'mid') return true
  if (tier === 'late') return episodeIndex >= 2
  return false
}

// Soft tier penalty: mid/late storylets are eligible earlier than their
// natural unlock but pay a salience penalty when below it, so early
// game still *feels* early without being structurally locked. The
// penalty is large enough to outweigh a single tag overlap but small
// enough that a mid storylet matching 2+ flavor tags can still win.
function tierPenalty(tier: StoryletTier, episodeIndex: number): number {
  if (tier === 'mid' && episodeIndex < 1) return 0.75
  if (tier === 'late' && episodeIndex < 2) return 1.5
  return 0
}

function isInCooldown(
  storylet: Storylet,
  fired: FiredStorylet[],
  currentEpisode: number,
): boolean {
  const cooldown = storylet.cooldownEpisodes ?? DEFAULT_COOLDOWN
  for (let i = fired.length - 1; i >= 0; i--) {
    const entry = fired[i]!
    if (entry.id !== storylet.id) continue
    if (currentEpisode - entry.firedAtEpisode < cooldown) return true
    return false
  }
  return false
}

// Salience score has two components: tag-overlap with run-state tags
// and *requires-specificity* (count of non-empty requires keys). The
// specificity term is the Emily Short rule — among multiple eligible
// storylets, prefer the one whose preconditions match the current state
// most narrowly. Without it, a storylet like `solo_yc_recruit` (gated on
// `team=solo`) ties with `cofounder_pitch_generic` (empty requires) and
// loses on the hash tiebreak, defeating the whole point of the gate.
//
// Specificity weight is small (0.5/key) so it lifts ties but never
// outranks a higher tag-overlap score.
function saliencyScore(storylet: Storylet, state: SelectionState): number {
  let score = 0
  if (storylet.tags && storylet.tags.length > 0) {
    const contextTags = new Set<string>()
    state.flavorTags.forEach((t) => contextTags.add(t.toLowerCase()))
    if (state.tone) contextTags.add(state.tone.toLowerCase())
    if (state.rolledCameos) {
      state.rolledCameos.forEach((c) => contextTags.add(c.toLowerCase()))
    }
    for (const tag of storylet.tags) {
      if (contextTags.has(tag.toLowerCase())) score++
    }
  }
  const specificity = Object.keys(storylet.requires).length
  return (
    score
    + specificity * 0.5
    - tierPenalty(storylet.tier, state.episodeIndex)
    + shapeBonus(storylet, state.episodeShape)
  )
}

// Tiebreaker hash. Stable per (storylet id, seed) so two players with
// identical run-state pick DIFFERENT storylets when scores tie — that
// was a real bug observed in the 2026-04-28 play data: same startup +
// pitch + persona produced the same 5-storylet sequence across two
// playthroughs. Mixing the playthrough seed in here breaks that
// determinism per-player while keeping it stable for the SAME player
// across re-selections (e.g. /history replay).
function stableHash(s: string, seed?: string): number {
  let h = 2166136261 >>> 0
  const input = seed ? `${s}|${seed}` : s
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// Per-episode shape roll. Hash mixes "shape:" + episodeIndex + seed
// so the same player gets the same shape on a /history replay but two
// players see different shapes for the same episodeIndex. Episode 0
// is always default — anchoring the player's first impression.
function rollEpisodeShape(
  episodeIndex: number,
  seed: string | undefined,
): EpisodeShape {
  if (episodeIndex === 0) return 'default'
  const r = stableHash(`shape:${episodeIndex}`, seed) % 100
  if (r < 75) return 'default'
  if (r < 85) return 'pressure'
  if (r < 95) return 'solo-night'
  return 'cameo-gauntlet'
}

// Shape-driven salience bonus. Layered on top of the base score in
// pickOneStorylet so the existing tag-overlap + specificity logic
// stays intact; shape just tilts the table.
function shapeBonus(storylet: Storylet, shape: EpisodeShape | undefined): number {
  if (!shape || shape === 'default') return 0
  if (shape === 'solo-night') {
    const kind = storylet.kind ?? 'encounter'
    return kind === 'solo' || kind === 'world-event' ? 1.5 : 0
  }
  if (shape === 'cameo-gauntlet') {
    return storylet.requires.cameo !== undefined ? 1.5 : 0
  }
  return 0 // 'pressure' shape biases archetype-diversity, not salience
}

function applyEffects(
  state: SelectionState,
  effects: Record<string, boolean> | undefined,
): SelectionState {
  if (!effects) return state
  return {
    ...state,
    storyletState: {
      ...state.storyletState,
      flags: { ...state.storyletState.flags, ...effects },
    },
  }
}

export interface SelectionResult {
  storylets: ChosenStorylet[]
  /** Final state after all 5 storylets' effects are applied. The route
   *  passes this back so the client can persist updated flags + fired
   *  list as part of the new arc skeleton. */
  finalState: StoryletState
  /** Shape rolled for this episode. Surfaced so the route can log it
   *  and the client can show debug telemetry. Not load-bearing. */
  episodeShape: EpisodeShape
}

// Walks the chosen storylets in order, attaching grounding anecdotes
// to each. Per-episode anecdote dedupe — once an anecdote is attached
// to scene N, it's excluded from N+1..4 so the same composite never
// grounds two scenes in the same episode. Pulled out of the picker
// loop so the choice-responsive single-storylet path can call it
// independently with a different alreadyUsed set.
function attachAnecdotes(
  storylets: Storylet[],
  seed: string | undefined,
  alreadyUsed: Set<string>,
): ChosenStorylet[] {
  return storylets.map((s) => {
    const anecdotes = pickAnecdotesForStorylet({
      storylet: s,
      alreadyUsed,
      seed,
      count: 2,
    })
    anecdotes.forEach((a) => alreadyUsed.add(a.id))
    return { ...s, groundingAnecdotes: anecdotes }
  })
}

// Inner-loop pick. Used by both selectEpisodeStorylets (called 5 times
// at episode start) and selectNextStorylet (called once at each group
// boundary mid-episode for choice-responsive re-selection). Pure
// function over (state, pickedIds, usedArchetypes) — no side effects.
function pickOneStorylet(
  state: SelectionState,
  pickedIds: ReadonlySet<string>,
  usedArchetypes: ReadonlySet<Archetype>,
): { chosen: Storylet | undefined; nextState: SelectionState } {
  const baseEligible = TEMPLATES.filter((s) => {
    if (pickedIds.has(s.id)) return false
    if (!tierEligibleAtEpisode(s.tier, state.episodeIndex)) return false
    if (isInCooldown(s, state.storyletState.fired, state.episodeIndex)) return false
    return evaluateRequires(s.requires, state)
  })
  // First pass: storylets whose archetype hasn't fired yet this
  // episode. Falls back to baseEligible if that pool is empty so
  // we never break the 5-scene schema. The "pressure" shape skips
  // this filter entirely so the same archetype can fire multiple
  // times — that's the whole point of pressure shape (every scene
  // is a fresh shockwave from one direction).
  const eligible =
    state.episodeShape === 'pressure'
      ? baseEligible
      : (() => {
          const fresh = baseEligible.filter((s) => !usedArchetypes.has(s.archetype))
          return fresh.length > 0 ? fresh : baseEligible
        })()

  let chosen: Storylet | undefined
  if (eligible.length > 0) {
    // Sort by salience desc, then by seed-aware stable hash for
    // deterministic ties that VARY across players.
    const scored = eligible
      .map((s) => ({ s, score: saliencyScore(s, state) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return stableHash(a.s.id, state.seed) - stableHash(b.s.id, state.seed)
      })
    chosen = scored[0]!.s
  } else {
    // Fallback: pick the least-recently-fired generic template (any
    // tier, ignoring cooldown) so we always emit 5 scenes. This is a
    // schema-preservation safety net and should be rare in practice
    // — the templates pack always includes at least 5 generics with
    // empty `requires`.
    // Sort by stableHash before picking [0] so the fallback choice is
    // deterministic across template-file edits.
    const genericFallbacks = TEMPLATES.filter(
      (s) => Object.keys(s.requires).length === 0 && !pickedIds.has(s.id),
    ).sort((a, b) => stableHash(a.id, state.seed) - stableHash(b.id, state.seed))
    chosen = genericFallbacks[0]
  }

  const nextState = chosen ? applyEffects(state, chosen.effects) : state
  return { chosen, nextState }
}

/**
 * Picks SCENES_PER_EPISODE storylets for the upcoming episode.
 *
 * Algorithm:
 *   1. Start from the supplied SelectionState.
 *   2. Pick the most-salient eligible storylet (filter by `requires`,
 *      cooldown, tier-at-episode, and not-already-picked-this-episode).
 *   3. Apply its effects to a *local* copy of state — subsequent picks
 *      see those flags. This lets a storylet that needs `flagSet:
 *      vcEncounter` fire as scene 4 if scene 1 was a VC scene that set
 *      the flag.
 *   4. Repeat until 5 are picked OR the eligible pool is exhausted.
 *   5. If exhausted, fall back to repeating the lowest-cooldown generic
 *      so we never break the schema (5-scene array is required).
 */
export function selectEpisodeStorylets(
  initialState: SelectionState,
): SelectionResult {
  const picked: Storylet[] = []
  // Roll the shape if the caller didn't supply one. Threading it
  // through state means every internal helper (saliencyScore,
  // pickOneStorylet) sees it without extra parameters.
  const episodeShape: EpisodeShape =
    initialState.episodeShape
    ?? rollEpisodeShape(initialState.episodeIndex, initialState.seed)
  let state: SelectionState = { ...initialState, episodeShape }
  const pickedIds = new Set<string>()
  // Archetype-diversity bookkeeping. Without this, the selector
  // happily fires two cofounder beats in one episode (e.g.
  // solo_yc_recruit + cofounder_pitch_generic) because both are
  // eligible and salience ties go to whichever sorts first. Hard
  // de-duplication: prefer fresh archetypes; only allow a repeat if
  // the fresh-archetype pool is empty.
  const usedArchetypes = new Set<Archetype>()

  for (let i = 0; i < SCENES_PER_EPISODE; i++) {
    const { chosen, nextState } = pickOneStorylet(state, pickedIds, usedArchetypes)
    if (!chosen) break
    picked.push(chosen)
    pickedIds.add(chosen.id)
    usedArchetypes.add(chosen.archetype)
    state = nextState
  }

  const newFired: FiredStorylet[] = [
    ...state.storyletState.fired,
    ...picked.map((s) => ({
      id: s.id,
      firedAtEpisode: initialState.episodeIndex,
    })),
  ]

  const enriched = attachAnecdotes(picked, initialState.seed, new Set<string>())

  return {
    storylets: enriched,
    finalState: {
      fired: newFired,
      flags: state.storyletState.flags,
    },
    episodeShape,
  }
}

export interface NextStoryletInput {
  /** Already-picked-this-episode (id + archetype) so we don't repeat ids
   *  or break archetype-diversity. */
  alreadyPicked: { id: string; archetype: Archetype }[]
}

export interface NextStoryletResult {
  storylet: ChosenStorylet | null
  /** Updated storylet state after applying the chosen storylet's
   *  effects + appending it to the fired list. The client persists
   *  this on the arc and passes it back into the next call. */
  finalState: StoryletState
}

/**
 * Single-storylet variant of selectEpisodeStorylets. Used by
 * /api/storylet/next to re-pick the upcoming storylet at every group
 * boundary, given the player's choices so far. Choice-responsive
 * selection — the whole point is that scene N+1's beat depends on
 * what happened in scene N.
 */
export function selectNextStorylet(
  state: SelectionState,
  input: NextStoryletInput,
): NextStoryletResult {
  const pickedIds = new Set(input.alreadyPicked.map((p) => p.id))
  const usedArchetypes = new Set<Archetype>(
    input.alreadyPicked.map((p) => p.archetype),
  )
  const { chosen, nextState } = pickOneStorylet(state, pickedIds, usedArchetypes)
  if (!chosen) {
    return { storylet: null, finalState: state.storyletState }
  }
  // No alreadyUsed bookkeeping here — choice-responsive picks fire
  // mid-episode and we don't track which anecdotes the arc-gen path
  // already burned. A small overlap risk is acceptable; the cost of
  // plumbing it through every group boundary outweighs the payoff.
  const [enriched] = attachAnecdotes([chosen], state.seed, new Set<string>())
  return {
    storylet: enriched!,
    finalState: {
      fired: [
        ...nextState.storyletState.fired,
        { id: chosen.id, firedAtEpisode: state.episodeIndex },
      ],
      flags: nextState.storyletState.flags,
    },
  }
}
