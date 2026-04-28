import templatesData from './templates.json'
import { evaluateRequires } from './predicate'
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

// Tiebreaker: stable per-state hash so re-selections within the same
// run state are deterministic. Uses storylet id only — the variance
// across runs comes from state divergence, not from the tiebreaker.
function stableHash(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
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

  for (let i = 0; i < SCENES_PER_EPISODE; i++) {
    const eligible = TEMPLATES.filter((s) => {
      if (pickedIds.has(s.id)) return false
      if (!tierEligibleAtEpisode(s.tier, state.episodeIndex)) return false
      if (isInCooldown(s, state.storyletState.fired, state.episodeIndex)) return false
      return evaluateRequires(s.requires, state)
    })

    let chosen: Storylet | undefined
    if (eligible.length > 0) {
      // Sort by salience desc, then by stable hash for deterministic ties.
      const scored = eligible
        .map((s) => ({ s, score: saliencyScore(s, state) }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          return stableHash(a.s.id) - stableHash(b.s.id)
        })
      chosen = scored[0]!.s
    } else {
      // Fallback: pick the least-recently-fired generic template (any
      // tier, ignoring cooldown) so we always emit 5 scenes. This is a
      // schema-preservation safety net and should be rare in practice
      // — the templates pack always includes at least 5 generics with
      // empty `requires`.
      // Sort by stableHash before picking [0] so the fallback choice is
      // deterministic across template-file edits. Without this, adding a
      // new template at the top of templates.json would change which
      // generic the fallback picks, silently breaking /history replays.
      const genericFallbacks = TEMPLATES.filter(
        (s) => Object.keys(s.requires).length === 0 && !pickedIds.has(s.id),
      ).sort((a, b) => stableHash(a.id) - stableHash(b.id))
      chosen = genericFallbacks[0]
    }

    if (!chosen) break
    picked.push(chosen)
    pickedIds.add(chosen.id)
    state = applyEffects(state, chosen.effects)
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
