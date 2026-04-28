import type { Archetype } from '../types'

// One authored card in the storylet bag. The engine picks which storylets
// fire each episode; the LLM only renders the chosen beats. See
// STORYLETS.md for the architectural rationale.

export type StoryletTier = 'early' | 'mid' | 'late'

// What KIND of moment this storylet is. Defaults to "encounter" — a
// scene where the assigned archetype walks in and speaks. Other kinds
// break that pattern, which the research (Failbetter, Reigns, Hades,
// Hidden Door review) identifies as the dominant "every run feels the
// same" failure mode for narrative-LLM games:
//   - "solo" — no NPC. Player + narrator only. A 4am bug fix, a
//     Dolores Park walk, a Caltrain reflection.
//   - "world-event" — something happens in the world the player reacts
//     to. A competitor launch, an X account ban, a viral tweet. May or
//     may not have an NPC speaker.
export type StoryletKind = 'encounter' | 'solo' | 'world-event'

export type TeamCondition = 'solo' | 'named'
export type FundingCondition = 'raising' | 'bootstrapping' | 'unstated'

// Predicate over current run state. ALL keys present must match (AND
// semantics). Missing keys are unconstrained. Designed to be a flat object
// so JSON authoring stays readable; the predicate evaluator (predicate.ts)
// walks each key and short-circuits on the first mismatch.
export interface StoryletRequires {
  hypeGte?: number
  hypeLte?: number
  integrityGte?: number
  integrityLte?: number
  team?: TeamCondition
  funding?: FundingCondition
  flagSet?: string
  flagNotSet?: string
  /** Cameo id (e.g. "sam-altman") that must appear in rolledCameos.
   *  Evaluates false if no rolledCameos field is supplied — graceful
   *  degradation when the cameo PR hasn't shipped yet. */
  cameo?: string
  /** Tone id that must equal current tone. False if no tone is supplied. */
  tone?: string
  flavorTag?: string
  /** Min total storylets fired prior to this one. Locks late-tier
   *  content behind playtime. */
  firedCountGte?: number
}

export interface Storylet {
  id: string
  /** Archetype anchor — for encounter storylets, this is the speaking
   *  NPC. For solo/world-event storylets, the archetype is a thematic
   *  category only (used for salience scoring + image flavor); no
   *  NPC of that archetype actually speaks in the rendered scene. */
  archetype: Archetype
  tier: StoryletTier
  /** What kind of moment. Defaults to "encounter" when omitted. */
  kind?: StoryletKind
  /** Predicate over run state. Empty `{}` = always eligible. */
  requires: StoryletRequires
  /** One-line plot template (≤220 chars). The LLM may incorporate the
   *  player's startup name + persona when rendering, but cannot
   *  fundamentally alter the action. */
  beat: string
  /** Flags this storylet flips on selection. Other storylets within the
   *  same episode see these flags; they also persist across episodes. */
  effects?: Record<string, boolean>
  /** Salience-scoring tags — used to break ties among eligible storylets
   *  by counting overlap with current run-state tags. */
  tags?: string[]
  /** Episodes to suppress this storylet after firing. Default 2. */
  cooldownEpisodes?: number
}

export interface FiredStorylet {
  id: string
  firedAtEpisode: number
}

export interface StoryletState {
  fired: FiredStorylet[]
  flags: Record<string, boolean>
}

// Snapshot of the run state the selector reads from. Built server-side
// from the request body (see /api/generate-arc/route.ts).
export interface SelectionState {
  episodeIndex: number
  hype: number
  integrity: number
  team?: TeamCondition
  funding?: FundingCondition
  storyletState: StoryletState
  /** Optional: composes with PR #23 (cameo + tone). Storylets that
   *  reference cameos/tone gracefully evaluate false when these are
   *  missing, so this PR ships independently of #23. */
  rolledCameos?: string[]
  tone?: string
  flavorTags: string[]
}
