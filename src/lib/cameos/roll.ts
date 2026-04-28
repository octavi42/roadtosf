import cameosData from './cameos.json'
import type { Cameo, RolledCameo } from './types'

const CAMEOS = cameosData as unknown as Cameo[]

// Pick this many cameos per run. Three is enough to feel "the city saw you"
// without flooding 5 archetype groups with mandatory celebrities.
const PICK_COUNT = 3

export interface RollCameosInput {
  flavorTags: string[]
  founderPersona: string
  /** Stable per playthrough — same seed = same rolls. */
  seed: string
  currentStats?: { hype: number; integrity: number }
}

// Same mulberry32 used by lib/lore.ts so cameo seeding behaves the same way.
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function makeRng(seed: string): () => number {
  let s = hashSeed(`${seed}:cameos`) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function scoreCameo(c: Cameo, input: RollCameosInput): number {
  // Base score: inverted rarity so common cameos start with more weight.
  // (A 4% cameo gets base 0.04; we keep it that small so flavor multipliers
  // can lift it but it never beats an 18% cameo by accident.)
  let score = c.baseRarity

  const tagSet = new Set(input.flavorTags.map((t) => t.toLowerCase()))
  for (const [tag, mult] of Object.entries(c.tagWeights)) {
    if (tagSet.has(tag.toLowerCase())) score *= mult
  }

  const persona = input.founderPersona.toLowerCase()
  for (const hint of c.personaHints) {
    if (persona.includes(hint.toLowerCase())) score *= 1.5
  }

  if (c.statHint && input.currentStats) {
    const v = input.currentStats[c.statHint.field]
    if (c.statHint.direction === 'high' && v >= 3) score *= 1.4
    if (c.statHint.direction === 'low' && v <= -3) score *= 1.4
  }

  return score
}

// Weighted-without-replacement pick using cumulative weights and a uniform
// roll. Standard reservoir-style: O(n²) but n=15 so trivial.
function weightedPick(
  pool: { item: Cameo; score: number }[],
  k: number,
  rng: () => number,
): Cameo[] {
  const out: Cameo[] = []
  const remaining = [...pool]
  while (out.length < k && remaining.length > 0) {
    const total = remaining.reduce((a, b) => a + b.score, 0)
    if (total <= 0) break
    let r = rng() * total
    let idx = 0
    for (let i = 0; i < remaining.length; i++) {
      r -= remaining[i]!.score
      if (r <= 0) {
        idx = i
        break
      }
    }
    const picked = remaining.splice(idx, 1)[0]!
    out.push(picked.item)
  }
  return out
}

/**
 * Rolls 3 cameos from the curated pool. Score = baseRarity × tag-match
 * × persona-hint × optional stat-hint. Picks are seeded by playthroughId
 * so the same seed always produces the same cameos. At most one cameo
 * per archetype — keeps the splice from collapsing every group into the
 * same celebrity bucket.
 */
export function rollCameos(input: RollCameosInput): RolledCameo[] {
  const rng = makeRng(input.seed)
  const scored = CAMEOS.map((c) => ({ item: c, score: scoreCameo(c, input) }))
    .filter((s) => s.score > 0)

  // Pick more than we need, then dedupe by archetype keeping the first hit.
  const oversampled = weightedPick(scored, Math.min(PICK_COUNT * 3, scored.length), rng)
  const seen = new Set<string>()
  const final: Cameo[] = []
  for (const c of oversampled) {
    if (seen.has(c.archetype)) continue
    seen.add(c.archetype)
    final.push(c)
    if (final.length >= PICK_COUNT) break
  }

  return final.map((c) => ({
    id: c.id,
    displayName: c.displayName,
    archetype: c.archetype,
    rarity: Math.round(c.baseRarity * 100),
    blurb: c.blurb,
  }))
}
