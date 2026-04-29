import { mulberry32 } from '@/lib/lore'
import type { LorePeopleRole, SfEvent, SfPerson, SfStory } from './lore-db'

// Stage 1 of the picker (LORE_SYSTEM.md §3.1): pure, deterministic
// candidate-set construction. No DB, no LLM. Everything in this file is
// unit-tested — see tests/candidates.test.ts.
//
// The contract is: same (corpus, input) → same candidate IDs and order,
// every time. That's what makes the playthrough seed feel like fate.

export interface CandidateInput {
  flavorTags: string[]
  stats: { hype: number; integrity: number }
  alreadyEncountered: {
    eventIds?: string[]
    peopleIds?: string[]
    storyIds?: string[]
  }
  /** playthroughId — keeps two players' picks distinct even on identical state */
  seed: string
  /**
   * Tone of the most recent episode. Stories matching this tone are *down*-
   * weighted so the player doesn't get the same flavor twice in a row.
   * Optional — episode 0 has no last tone.
   */
  lastEpisodeTone?: SfStory['tone']
  /** "now" override for tests; defaults to Date.now() */
  now?: Date
}

export interface CandidateSet {
  events: ScoredEvent[]
  people: ScoredPerson[]
  stories: ScoredStory[]
}

export interface ScoredEvent {
  event: SfEvent
  score: number
}
export interface ScoredPerson {
  person: SfPerson
  score: number
}
export interface ScoredStory {
  story: SfStory
  score: number
}

// Stage 1 caps from LORE_SYSTEM.md §3 — these match what the picker prompt
// is sized for. Bumping these is fine but means re-tuning Haiku's max_tokens.
export const CANDIDATE_CAPS = {
  events: 8,
  people: 12,
  stories: 10,
} as const

// "Wildcard" pool size: famous-people seeded into the candidate pool even
// when no live event ties them in. Keeps the hype=4 → sam-altman bias
// composable with the regular event-attendee path.
const WILDCARD_PER_EPISODE = 3

// Stat-bias rules (LORE_SYSTEM.md §3.1, "Hard stat-bias rules live here").
// Each rule fires deterministically on player state and adds a person to
// the candidate pool with a flat score boost. Rules live as data, not
// branches, so adding "integrity ≤ -3 → reid-hoffman cameo" is a one-liner.
interface StatBiasRule {
  personId: string
  predicate: (stats: CandidateInput['stats']) => boolean
  boost: number
}
const STAT_BIAS_RULES: StatBiasRule[] = [
  // hype ≥ 4 → sam-altman lands as fate (the "altmanned" achievement hook).
  { personId: 'sam-altman', predicate: (s) => s.hype >= 4, boost: 5 },
]

// Role-relevance gate. Roles listed here only enter the wildcard pool
// when at least one of the listed flavor tags is active for this
// episode. Reporters were polluting every run because the corpus is
// small (~9 reporters out of ~50 people) so they kept landing as
// wildcards regardless of theme — Priya Anand showing up in every
// startup-fundraising episode despite zero press relevance.
//
// Attendee-derived candidates (people listed on a selected event)
// bypass this gate: events themselves are scored by tag overlap, so a
// reporter at a launch party already passed a relevance filter.
const ROLE_RELEVANCE_TAGS: Partial<Record<LorePeopleRole, string[]>> = {
  reporter: [
    'press',
    'media',
    'launch',
    'announcement',
    'controversy',
    'scandal',
    'leak',
    'pr',
    'coverage',
  ],
}

function isRoleRelevant(role: LorePeopleRole, flavorSet: Set<string>): boolean {
  const required = ROLE_RELEVANCE_TAGS[role]
  if (!required) return true
  for (const tag of required) {
    if (flavorSet.has(tag)) return true
  }
  return false
}

// recencyBoost: 0..2, peaks at "tonight" and falls off as the event ages or
// drifts further out. Curve is intentionally simple — same-day = 2,
// today-or-tomorrow = ~1.5, this week = ~0.5..1, beyond = 0.
function recencyBoost(eventISO: string, nowMs: number): number {
  const t = Date.parse(eventISO)
  if (Number.isNaN(t)) return 0
  const hours = (t - nowMs) / (60 * 60 * 1000)
  if (hours < -6) return 0 // already long past
  if (hours <= 12) return 2 // tonight
  if (hours <= 36) return 1.5
  if (hours <= 96) return 1 // ~next 4 days
  if (hours <= 7 * 24) return 0.5
  return 0
}

function intersectCount(a: string[] | undefined, b: Set<string>): number {
  if (!a || a.length === 0 || b.size === 0) return 0
  let n = 0
  for (const x of a) {
    if (b.has(x.toLowerCase())) n++
  }
  return n
}

function lowerSet(items: string[]): Set<string> {
  return new Set(items.map((s) => s.toLowerCase()))
}

// ── Events ──────────────────────────────────────────────────────────

export function scoreEvent(
  event: SfEvent,
  flavorSet: Set<string>,
  seed: string,
  nowMs: number,
): number {
  const tagOverlap = intersectCount(event.tags, flavorSet)
  const recency = recencyBoost(event.startAt, nowMs)
  const jitter = 0.5 * mulberry32(`${seed}:event:${event.id}`)
  return 3 * tagOverlap + recency + jitter
}

export function pickCandidateEvents(
  events: SfEvent[],
  input: CandidateInput,
  nowMs: number,
): ScoredEvent[] {
  const exclude = new Set(input.alreadyEncountered.eventIds ?? [])
  const flavorSet = lowerSet(input.flavorTags)
  return events
    .filter((e) => !exclude.has(e.id))
    .map((event) => ({ event, score: scoreEvent(event, flavorSet, input.seed, nowMs) }))
    .sort((a, b) => b.score - a.score || a.event.id.localeCompare(b.event.id))
    .slice(0, CANDIDATE_CAPS.events)
}

// ── People ──────────────────────────────────────────────────────────

// Score a single person by flavor-tag overlap + a deterministic jitter so
// equal-overlap candidates don't always sort the same way.
function basePersonScore(person: SfPerson, flavorSet: Set<string>, seed: string): number {
  const tagOverlap = intersectCount(person.tags, flavorSet)
  const jitter = 0.4 * mulberry32(`${seed}:person:${person.id}`)
  return 2 * tagOverlap + jitter
}

// Walk candidate events, gather everyone listed in known_attendees + a
// salted random sample of "wildcards" (people not anchored to a venue).
// Apply stat-bias rules. Subtract excluded IDs. Cap.
//
// Returns ScoredPerson[] sorted by score desc with stable tiebreak.
export function pickCandidatePeople(
  people: SfPerson[],
  candidateEvents: ScoredEvent[],
  input: CandidateInput,
): ScoredPerson[] {
  const exclude = new Set(input.alreadyEncountered.peopleIds ?? [])
  const flavorSet = lowerSet(input.flavorTags)
  const peopleById = new Map(people.map((p) => [p.id, p]))

  // 1) People named in the candidate events' known_attendees lists.
  const attendeeIds = new Set<string>()
  for (const e of candidateEvents) {
    for (const id of e.event.knownAttendees) attendeeIds.add(id)
  }

  // 2) Sample N wildcards from the full pool, deterministic per seed.
  // Apply role-relevance gate: reporters only wildcard when the
  // episode's flavor tags signal press relevance. Other roles are
  // ungated.
  const wildcards = sampleN(
    people.filter(
      (p) => !attendeeIds.has(p.id) && isRoleRelevant(p.role, flavorSet),
    ),
    WILDCARD_PER_EPISODE,
    `${input.seed}:wildcard`,
  )

  const candidateIds = new Set<string>([...attendeeIds, ...wildcards.map((p) => p.id)])
  const scored: ScoredPerson[] = []
  for (const id of candidateIds) {
    if (exclude.has(id)) continue
    const person = peopleById.get(id)
    if (!person) continue
    scored.push({ person, score: basePersonScore(person, flavorSet, input.seed) })
  }

  // 3) Stat-bias rules: add or boost specific named figures.
  for (const rule of STAT_BIAS_RULES) {
    if (!rule.predicate(input.stats)) continue
    if (exclude.has(rule.personId)) continue
    const person = peopleById.get(rule.personId)
    if (!person) continue
    const existing = scored.find((s) => s.person.id === rule.personId)
    if (existing) {
      existing.score += rule.boost
    } else {
      scored.push({
        person,
        score: basePersonScore(person, flavorSet, input.seed) + rule.boost,
      })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.person.id.localeCompare(b.person.id))
    .slice(0, CANDIDATE_CAPS.people)
}

// ── Stories ─────────────────────────────────────────────────────────

export function scoreStory(
  story: SfStory,
  flavorSet: Set<string>,
  seed: string,
  lastTone: SfStory['tone'] | undefined,
): number {
  const tagOverlap = intersectCount(story.tags, flavorSet)
  const toneAdjust = lastTone === undefined ? 0 : story.tone === lastTone ? -1 : 1
  const jitter = 0.3 * mulberry32(`${seed}:story:${story.id}`)
  return tagOverlap + toneAdjust + jitter
}

export function pickCandidateStories(
  stories: SfStory[],
  input: CandidateInput,
): ScoredStory[] {
  const exclude = new Set(input.alreadyEncountered.storyIds ?? [])
  const flavorSet = lowerSet(input.flavorTags)
  return stories
    .filter((s) => !exclude.has(s.id))
    .map((story) => ({
      story,
      score: scoreStory(story, flavorSet, input.seed, input.lastEpisodeTone),
    }))
    .sort((a, b) => b.score - a.score || a.story.id.localeCompare(b.story.id))
    .slice(0, CANDIDATE_CAPS.stories)
}

// ── Driver ──────────────────────────────────────────────────────────

export function buildCandidateSet(
  corpus: { events: SfEvent[]; people: SfPerson[]; stories: SfStory[] },
  input: CandidateInput,
): CandidateSet {
  const nowMs = (input.now ?? new Date()).getTime()
  const events = pickCandidateEvents(corpus.events, input, nowMs)
  const people = pickCandidatePeople(corpus.people, events, input)
  const stories = pickCandidateStories(corpus.stories, input)
  return { events, people, stories }
}

// ── Helpers ─────────────────────────────────────────────────────────

// Deterministic shuffle-then-take-N. Used for wildcard sampling so two
// playthroughs with the same flavor mix still get different cameos.
export function sampleN<T extends { id: string }>(items: T[], n: number, seed: string): T[] {
  if (items.length === 0 || n <= 0) return []
  const sorted = [...items]
    .map((item, i) => ({ item, key: mulberry32(`${seed}:${item.id}:${i}`) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item)
  return sorted.slice(0, Math.min(n, sorted.length))
}
