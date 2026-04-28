import type { ToneId, ToneSpec } from './types'

// Five run-tones. Rolled once per run from flavor tags + persona, then
// spliced into every prompt as a one-liner. Cheapest possible diversity
// injection — five categorical flavors over the same skeleton produce
// noticeably different runs without changing any structural code.
const TONES: Record<ToneId, ToneSpec> = {
  'paranoid-thriller': {
    id: 'paranoid-thriller',
    label: 'Paranoid Thriller',
    oneLiner:
      'TONE: paranoid thriller. Surveillance-coded, money-poisoning, characters glance at phones too often. Dialogue lands like an unsigned NDA.',
  },
  'hype-pilled-comedy': {
    id: 'hype-pilled-comedy',
    label: 'Hype-Pilled Comedy',
    oneLiner:
      'TONE: hype-pilled comedy. Twitter-poast cadence, half-ironic capitalisation, characters quote their own pinned tweet mid-conversation. Lean into absurd over-confidence.',
  },
  'slow-burn-tragedy': {
    id: 'slow-burn-tragedy',
    label: 'Slow-Burn Tragedy',
    oneLiner:
      'TONE: slow-burn tragedy. Quiet, melancholy, the missed-connection register. Characters say less than they mean. Beats land on what is NOT said.',
  },
  'delusional-mania': {
    id: 'delusional-mania',
    label: 'Delusional Mania',
    oneLiner:
      'TONE: delusional mania. Founder energy past 11. Numbers get bigger every line, no one sleeps, every scene has a whiteboard reference. Cinematic, unhinged, fun.',
  },
  'contrarian-fable': {
    id: 'contrarian-fable',
    label: 'Contrarian Fable',
    oneLiner:
      'TONE: contrarian fable. The heretic founder; characters keep handing the player money and the player keeps walking. Dialogue sharp, almost moralistic, with a wry priest energy.',
  },
}

export interface RollToneInput {
  flavorTags: string[]
  founderPersona: string
  seed: string
}

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function makeRng(seed: string): () => number {
  let s = hashSeed(`${seed}:tone`) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Affinity heuristics — keep them modest so the seeded RNG still has room
// to surprise. Every tone keeps a base weight of 1 so any run can roll any
// tone, just with different probabilities.
function scoreTone(id: ToneId, input: RollToneInput): number {
  const tags = new Set(input.flavorTags.map((t) => t.toLowerCase()))
  const p = input.founderPersona.toLowerCase()
  let s = 1
  switch (id) {
    case 'paranoid-thriller':
      if (tags.has('crypto')) s += 1.5
      if (p.includes('cynical') || p.includes('serial')) s += 1
      if (p.includes('anxious')) s += 0.5
      return s
    case 'hype-pilled-comedy':
      if (tags.has('hype')) s += 2
      if (tags.has('ai')) s += 1
      if (p.includes('manic') || p.includes('loud')) s += 1
      return s
    case 'slow-burn-tragedy':
      if (tags.has('defeat') || tags.has('recovery')) s += 2
      if (p.includes('quiet') || p.includes('first-time') || p.includes('anxious'))
        s += 1
      return s
    case 'delusional-mania':
      if (tags.has('hype') || tags.has('partying')) s += 1.5
      if (p.includes('manic') || p.includes('ambitious')) s += 1.5
      return s
    case 'contrarian-fable':
      if (p.includes('contrarian') || p.includes('heretic') || p.includes('bootstrapped'))
        s += 2
      if (tags.has('mentor') || tags.has('founder')) s += 0.5
      return s
  }
}

export function rollTone(input: RollToneInput): ToneSpec {
  const rng = makeRng(input.seed)
  const scored = (Object.keys(TONES) as ToneId[]).map((id) => ({
    id,
    score: scoreTone(id, input),
  }))
  const total = scored.reduce((a, b) => a + b.score, 0)
  let r = rng() * total
  for (const s of scored) {
    r -= s.score
    if (r <= 0) return TONES[s.id]
  }
  return TONES[scored[scored.length - 1]!.id]
}

export function getToneSpec(id: ToneId): ToneSpec {
  return TONES[id]
}
