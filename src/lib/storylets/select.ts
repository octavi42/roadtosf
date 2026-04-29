import templatesData from './templates.json'
import { evaluateRequires } from './predicate'
import type { Archetype } from '../types'
import type {
  FiredStorylet,
  SelectionState,
  Storylet,
  StoryletState,
  StoryletTier,
} from './types'

const TEMPLATES = templatesData as unknown as Storylet[]
const SCENES_PER_EPISODE = 5
const DEFAULT_COOLDOWN = 2
/** Episode-architecture seed pool size. Larger than SCENES_PER_EPISODE
 *  so the LLM planner has real choice; the planner picks 3–5. */
const EPISODE_SEED_POOL_SIZE = 6

// Tier gates: which tiers are eligible at a given episode index. Early
// runs are dominated by 'early' storylets; later episodes unlock the
// 'mid' and 'late' bag, so the *menu* grows as the player plays. This
// is the "tiered unlock gates" piece of the endless-mode design.
function tierEligibleAtEpisode(tier: StoryletTier, episodeIndex: number): boolean {
  if (tier === 'early') return true
  if (tier === 'mid') return episodeIndex >= 1
  if (tier === 'late') return episodeIndex >= 3
  return false
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
  return score + specificity * 0.5
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
  storylets: Storylet[]
  /** Final state after all 5 storylets' effects are applied. The route
   *  passes this back so the client can persist updated flags + fired
   *  list as part of the new arc skeleton. */
  finalState: StoryletState
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
  // we never break the 5-scene schema.
  const fresh = baseEligible.filter((s) => !usedArchetypes.has(s.archetype))
  const eligible = fresh.length > 0 ? fresh : baseEligible

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
  let state = initialState
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

  return {
    storylets: picked,
    finalState: {
      fired: newFired,
      flags: state.storyletState.flags,
    },
  }
}

export interface NextStoryletInput {
  /** Already-picked-this-episode (id + archetype) so we don't repeat ids
   *  or break archetype-diversity. */
  alreadyPicked: { id: string; archetype: Archetype }[]
}

export interface NextStoryletResult {
  storylet: Storylet | null
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
  return {
    storylet: chosen,
    finalState: {
      fired: [
        ...nextState.storyletState.fired,
        { id: chosen.id, firedAtEpisode: state.episodeIndex },
      ],
      flags: nextState.storyletState.flags,
    },
  }
}

/**
 * Episode-architecture entry point. Returns a pool of candidate
 * storylets for the LLM episode planner to pick from. Filters for
 * tier-eligibility, predicate match, and excludes anything already
 * fired this run (cross-episode cooldown via firedSeedIds — replaces
 * the old per-storylet cooldownEpisodes machinery).
 *
 * Sorted by salience desc, with seed-aware stable hash tiebreak.
 * Returns up to EPISODE_SEED_POOL_SIZE entries; the LLM picks 3–5.
 */
export function selectEpisodeSeeds(
  state: SelectionState,
  firedSeedIds: ReadonlyArray<string>,
): Storylet[] {
  const fired = new Set(firedSeedIds)
  const eligible = TEMPLATES.filter((s) => {
    if (fired.has(s.id)) return false
    if (!tierEligibleAtEpisode(s.tier, state.episodeIndex)) return false
    return evaluateRequires(s.requires, state)
  })
  if (eligible.length === 0) {
    // Schema-preservation safety net: serve generic templates so the
    // planner always has something to pick from. Excluded-firedSeedIds
    // still applies — once everything has fired, the planner picks
    // freely from the exhausted pool.
    return TEMPLATES.filter((s) => Object.keys(s.requires).length === 0).slice(
      0,
      EPISODE_SEED_POOL_SIZE,
    )
  }
  return eligible
    .map((s) => ({ s, score: saliencyScore(s, state) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return stableHash(a.s.id, state.seed) - stableHash(b.s.id, state.seed)
    })
    .slice(0, EPISODE_SEED_POOL_SIZE)
    .map(({ s }) => s)
}
