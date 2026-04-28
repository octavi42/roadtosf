import corpusData from './corpus.json'
import type { Anecdote } from './types'
import type { Storylet } from '../storylets/types'

const CORPUS = corpusData as unknown as Anecdote[]

// FNV-1a (mirrors the storylet selector's hash). Mixing the seed in
// makes anecdote draws per-playthrough deterministic without making
// them globally identical across players.
function stableHash(s: string, seed?: string): number {
  let h = 2166136261 >>> 0
  const input = seed ? `${s}|${seed}` : s
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// Score how well an anecdote grounds a storylet. Direct id-match is
// the strongest signal (an author tagged this exact storylet); after
// that, archetype + tag overlap. Vibe is intentionally not scored —
// it's a curation hint, not a runtime constraint.
function scoreAnecdoteForStorylet(
  anecdote: Anecdote,
  storylet: Storylet,
): number {
  let score = 0
  if (anecdote.matchesStoryletIds?.includes(storylet.id)) score += 10
  if (anecdote.matchesArchetypes.includes(storylet.archetype)) score += 3
  if (storylet.tags && storylet.tags.length > 0) {
    const storyletTags = new Set(storylet.tags.map((t) => t.toLowerCase()))
    for (const tag of anecdote.tags) {
      if (storyletTags.has(tag.toLowerCase())) score += 1
    }
  }
  return score
}

export interface AnecdotePickInput {
  storylet: Storylet
  /** Anecdotes already drawn elsewhere this episode — exclude them so
   *  the same composite doesn't ground two different scenes. */
  alreadyUsed: ReadonlySet<string>
  /** Per-playthrough seed (the playthroughId). Mixed into the hash so
   *  two players with identical state pick different anecdotes when
   *  scores tie. */
  seed?: string
  /** How many anecdotes to attach. Default 2 — enough texture for the
   *  LLM to lift a detail or two without crowding the prompt. */
  count?: number
}

/**
 * Picks up to N anecdotes that best ground the given storylet.
 *
 * Scoring is direct: storylet-id match (+10), archetype match (+3),
 * tag overlap (+1 per tag). Ties broken by seeded stable hash so the
 * same player gets the same draw on a /history replay but two players
 * see different anecdotes for the same storylet.
 *
 * Returns an empty array if no anecdotes score above zero — better to
 * skip grounding than to attach a misfit composite.
 */
export function pickAnecdotesForStorylet(
  input: AnecdotePickInput,
): Anecdote[] {
  const count = input.count ?? 2
  const candidates = CORPUS.filter((a) => !input.alreadyUsed.has(a.id))
    .map((a) => ({ a, score: scoreAnecdoteForStorylet(a, input.storylet) }))
    .filter((entry) => entry.score > 0)

  if (candidates.length === 0) return []

  candidates.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score
    return stableHash(`${input.storylet.id}|${x.a.id}`, input.seed)
      - stableHash(`${input.storylet.id}|${y.a.id}`, input.seed)
  })

  return candidates.slice(0, count).map((entry) => entry.a)
}
