import type { Archetype } from '../types'

// One curated SF figure who can show up "as fate" in a run. Lives in
// cameos.json. Real-name override (same exemption as the Silicon Mania
// splice): when rolled, the arc prompt is allowed to name them verbatim.
export interface Cameo {
  id: string
  displayName: string
  /** Anchor archetype — the group whose scene the cameo will inhabit. */
  archetype: Archetype
  /**
   * Pre-baked rarity tier (0..1). Doubles as both the base roll weight
   * (lower = rarer) and the value shown post-hoc on the ending screen.
   * Keeping these in lockstep means a 4% cameo really IS rare across
   * the population, not just rare-feeling.
   */
  baseRarity: number
  /** Flavor-tag → multiplier. Missing tag = 1× (no effect). */
  tagWeights: Record<string, number>
  /** Lowercase substrings in founder persona that bump weight. */
  personaHints: string[]
  /** Optional stat hint — at run-start stats are 0/0 so unused for now,
   *  but kept on the schema so mid-run re-rolls can light up later. */
  statHint?: {
    field: 'hype' | 'integrity'
    direction: 'high' | 'low'
  }
  /** One-line characterization the prompt feeds back to the model. */
  blurb: string
}

export interface RolledCameo {
  id: string
  displayName: string
  archetype: Archetype
  /** Display value 0..100 (baseRarity × 100, rounded). */
  rarity: number
  blurb: string
}

export type ToneId =
  | 'paranoid-thriller'
  | 'hype-pilled-comedy'
  | 'slow-burn-tragedy'
  | 'delusional-mania'
  | 'contrarian-fable'

export interface ToneSpec {
  id: ToneId
  label: string
  /** One-liner spliced into arc + scene prompts to color voice. */
  oneLiner: string
}
