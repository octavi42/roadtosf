import type { Archetype } from '../types'

// Real-founder grounding beats. One paraphrased composite per entry
// (never lifted from a single source; never names a real person doing
// a specific bad thing). Attached to chosen storylets at selection
// time so the arc-gen LLM has concrete, real-world texture to lean on
// instead of falling back to generic startup tropes.
//
// Curation rules (also enforced by the build script):
// - Composites only. If a single thread is recognizable, paraphrase
//   harder until it isn't.
// - Never includes the founder's real name. Roles only ("a SaaS
//   founder", "a YC W23 alum").
// - May include real PUBLIC SF places (Tartine, Rosewood, Caltrain) —
//   those are not defamation surfaces.
// - Real people's names are allowed only when the act is mundane and
//   public (e.g. "Paul Graham retweeted them"); never for accusatory
//   beats.

export interface Anecdote {
  id: string
  /** Paraphrased composite, ~280 chars max. Specific enough to give
   *  the LLM real texture (a place, a number, a hesitation) but
   *  generic enough that no single source is identifiable. */
  paraphrased: string
  /** Storylets this anecdote can ground. Match by id is preferred
   *  over archetype/tag matching — the picker uses these first. */
  matchesStoryletIds?: string[]
  /** Archetype anchors. Used when no storylet-id match is found. */
  matchesArchetypes: Archetype[]
  /** Salience-overlap tags — same vocabulary as storylet tags so a
   *  shared lookup works without extra mapping. */
  tags: string[]
  /** Tonal hint. Helps the picker prefer matching vibes (an "absurdist"
   *  scene gets an absurdist anecdote, not a tragic one). */
  vibe?:
    | 'vindicated'
    | 'tragic'
    | 'absurdist'
    | 'transactional'
    | 'humbling'
    | 'triumphant'
    | 'ominous'
}
