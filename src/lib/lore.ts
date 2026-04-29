import type { Archetype } from './types'
import { ARCHETYPES, type RoleDefinition as ArchetypeDefinition } from './archetypes'
import placesData from './lore/places.json'
import jokesData from './lore/running-jokes.json'
import zeitgeistData from './lore/zeitgeist.json'

export type LoreTone = 'cynical' | 'earnest' | 'hype' | 'absurd' | 'wistful'

// Canonical flavor-tag vocabulary. The intro extractor and lore affinityTags
// share this set so place/zeitgeist matching actually scores against the tags
// pulled from the player's intro.
export const FLAVOR_TAGS = [
  'vc',
  'fundraising',
  'founder',
  'product',
  'press',
  'mentor',
  'community',
  'partying',
  'recovery',
  'defeat',
  'hype',
  'ai',
  'crypto',
  'recruiting',
] as const
export type FlavorTag = (typeof FLAVOR_TAGS)[number]

export interface PlaceEntry {
  id: string
  name: string
  vibe: string
  affinityTags: string[]
}

export interface JokeEntry {
  id: string
  beat: string
  tone: LoreTone
}

export interface ZeitgeistEntry {
  id: string
  beat: string
  tone: LoreTone
  validUntil: string
  archetypeHook?: Archetype
}

export interface FilteredLore {
  archetype: ArchetypeDefinition
  places: PlaceEntry[]
  jokes: JokeEntry[]
  zeitgeist: ZeitgeistEntry[]
}

const PLACES = placesData as PlaceEntry[]
const JOKES = jokesData as JokeEntry[]
const ZEITGEIST = zeitgeistData as ZeitgeistEntry[]

export interface FilterInput {
  flavorTags: string[]
  sceneArchetype: Archetype
  todayISO: string
  seed?: string // pass playthroughId for stable picks across calls
  maxPlaces?: number
  maxJokes?: number
  maxZeitgeist?: number
}

// Tiny string-seeded PRNG (mulberry32). Stable across runs given the same seed.
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function makeRng(seed: string | undefined): () => number {
  if (!seed) return Math.random
  let s = hashSeed(seed) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function filterLore(input: FilterInput): FilteredLore {
  const {
    flavorTags,
    sceneArchetype,
    todayISO,
    seed,
    maxPlaces = 5,
    maxJokes = 3,
    maxZeitgeist = 3,
  } = input

  // Per-call rng but stable per (seed, sceneArchetype) — different scenes get
  // different lore picks within the same playthrough.
  const rng = makeRng(seed ? `${seed}:${sceneArchetype}` : undefined)
  const tagSet = new Set(flavorTags.map((t) => t.toLowerCase()))

  const places = [...PLACES]
    .map((p) => ({
      entry: p,
      score: p.affinityTags.filter((t) => tagSet.has(t.toLowerCase())).length,
      jitter: rng(),
    }))
    .sort((a, b) => b.score - a.score || b.jitter - a.jitter)
    .slice(0, maxPlaces)
    .map(({ entry }) => entry)

  const jokes = sampleVaryingTone(JOKES, maxJokes, rng)

  const zeitgeist = ZEITGEIST.filter((z) => z.validUntil >= todayISO)
    .map((z) => ({
      entry: z,
      score: z.archetypeHook === sceneArchetype ? 1 : 0,
      jitter: rng(),
    }))
    .sort((a, b) => b.score - a.score || b.jitter - a.jitter)
    .slice(0, maxZeitgeist)
    .map(({ entry }) => entry)

  return {
    archetype: ARCHETYPES[sceneArchetype],
    places,
    jokes,
    zeitgeist,
  }
}

function sampleVaryingTone<T extends { tone: LoreTone }>(
  items: T[],
  n: number,
  rng: () => number,
): T[] {
  const shuffled = [...items].sort(() => rng() - 0.5)
  const seenTones = new Set<LoreTone>()
  const picked: T[] = []
  for (const item of shuffled) {
    if (picked.length >= n) break
    if (!seenTones.has(item.tone)) {
      picked.push(item)
      seenTones.add(item.tone)
    }
  }
  for (const item of shuffled) {
    if (picked.length >= n) break
    if (!picked.includes(item)) picked.push(item)
  }
  return picked.slice(0, n)
}
