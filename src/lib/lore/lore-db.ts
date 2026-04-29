import { getSql } from '@/lib/db'

// Stage 0 of the picker (LORE_SYSTEM.md §3): read-only loaders against the
// three Neon tables created by migrations/0007_lore.sql. The candidates
// module (Stage 1) operates on the rows returned here. No scoring lives in
// this file — keep it dumb so we can swap the storage if Neon ever moves.

export type LoreTone = 'cynical' | 'earnest' | 'hype' | 'absurd' | 'wistful'
export type LorePeopleRole = 'vc' | 'cofounder' | 'reporter' | 'hater' | 'mentor'

export interface SfEvent {
  id: string
  name: string
  venue: string
  startAt: string // ISO 8601
  host: string | null
  url: string | null
  blurb: string | null
  knownAttendees: string[]
  tags: string[]
  scrapedAt: string
}

export interface SfPerson {
  id: string
  displayName: string
  role: LorePeopleRole
  vibe: string
  regularSpots: string[]
  xHandle: string | null
  encounterStyles: string[]
  tags: string[]
  achievementHook: string | null
}

export interface SfStory {
  id: string
  beat: string
  tone: LoreTone
  sourceUrl: string
  applicableArchetypes: string[]
  tags: string[]
  scrapedAt: string
}

// Defensive coercion — Neon returns `unknown[]` for TEXT[] columns and we
// don't want a stray non-string to crash downstream sort/filter passes.
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function asISO(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  return new Date(0).toISOString()
}

function asTone(v: unknown): LoreTone {
  return v === 'cynical' || v === 'earnest' || v === 'hype' || v === 'absurd' || v === 'wistful'
    ? v
    : 'cynical'
}

function asRole(v: unknown): LorePeopleRole {
  return v === 'vc' || v === 'cofounder' || v === 'reporter' || v === 'hater' || v === 'mentor'
    ? v
    : 'mentor'
}

// Live events in the next `days` (default 7). Past events are excluded so
// the picker never recommends a party that already happened. We accept a
// small leak (events that started ≤6h ago still match) — the satire game
// is fine with "you missed it last night" beats.
export async function loadLiveEvents(days = 7, now: Date = new Date()): Promise<SfEvent[]> {
  const sql = getSql()
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
  const rows = await sql`
    SELECT id, name, venue, start_at, host, url, blurb,
           known_attendees, tags, scraped_at
    FROM sf_events
    WHERE start_at >= ${sixHoursAgo} AND start_at <= ${horizon}
    ORDER BY start_at ASC
  `
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    venue: String(r.venue ?? ''),
    startAt: asISO(r.start_at),
    host: r.host == null ? null : String(r.host),
    url: r.url == null ? null : String(r.url),
    blurb: r.blurb == null ? null : String(r.blurb),
    knownAttendees: asStrArr(r.known_attendees),
    tags: asStrArr(r.tags),
    scrapedAt: asISO(r.scraped_at),
  }))
}

// Full people pool. ~50 rows; cheap. Keep as a single SELECT — sorting
// happens in the candidate module so the LLM-side cache is also stable.
export async function loadPeoplePool(): Promise<SfPerson[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, display_name, role, vibe, regular_spots,
           x_handle, encounter_styles, tags, achievement_hook
    FROM sf_people
    ORDER BY id ASC
  `
  return rows.map((r) => ({
    id: String(r.id),
    displayName: String(r.display_name ?? ''),
    role: asRole(r.role),
    vibe: String(r.vibe ?? ''),
    regularSpots: asStrArr(r.regular_spots),
    xHandle: r.x_handle == null ? null : String(r.x_handle),
    encounterStyles: asStrArr(r.encounter_styles),
    tags: asStrArr(r.tags),
    achievementHook: r.achievement_hook == null ? null : String(r.achievement_hook),
  }))
}

// Story pool — only stories scraped in the last `days`. Keeps the picker
// input focused on "what happened lately" and bounds the prompt size as
// sf_stories accumulates over time.
export async function loadRecentStories(days = 14, now: Date = new Date()): Promise<SfStory[]> {
  const sql = getSql()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  const rows = await sql`
    SELECT id, beat, tone, source_url, applicable_archetypes, tags, scraped_at
    FROM sf_stories
    WHERE scraped_at >= ${cutoff}
    ORDER BY scraped_at DESC
  `
  return rows.map((r) => ({
    id: String(r.id),
    beat: String(r.beat ?? ''),
    tone: asTone(r.tone),
    sourceUrl: String(r.source_url ?? ''),
    applicableArchetypes: asStrArr(r.applicable_archetypes),
    tags: asStrArr(r.tags),
    scrapedAt: asISO(r.scraped_at),
  }))
}

// Convenience for the picker route: load all three corpora in one round-trip.
export async function loadCorpus(opts: { eventDays?: number; storyDays?: number; now?: Date } = {}): Promise<{
  events: SfEvent[]
  people: SfPerson[]
  stories: SfStory[]
}> {
  const now = opts.now ?? new Date()
  const [events, people, stories] = await Promise.all([
    loadLiveEvents(opts.eventDays ?? 7, now),
    loadPeoplePool(),
    loadRecentStories(opts.storyDays ?? 14, now),
  ])
  return { events, people, stories }
}
