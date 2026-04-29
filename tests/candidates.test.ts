import { describe, expect, it } from 'vitest'

import {
  buildCandidateSet,
  pickCandidateEvents,
  pickCandidatePeople,
  pickCandidateStories,
  scoreEvent,
  scoreStory,
} from '@/lib/lore/candidates'
import type { SfEvent, SfPerson, SfStory } from '@/lib/lore/lore-db'

// ── Fixtures ────────────────────────────────────────────────────────

const REFERENCE_NOW = new Date('2026-04-29T18:00:00Z')

function makeEvent(overrides: Partial<SfEvent> = {}): SfEvent {
  return {
    id: 'e1',
    name: 'Demo Night',
    venue: 'AGI House',
    startAt: '2026-04-29T20:00:00Z', // tonight (~2h out)
    host: 'AGI House',
    url: null,
    blurb: 'demos and free food',
    knownAttendees: [],
    tags: ['ai', 'hype'],
    scrapedAt: '2026-04-28T00:00:00Z',
    ...overrides,
  }
}

function makePerson(overrides: Partial<SfPerson> = {}): SfPerson {
  return {
    id: 'sam-altman',
    displayName: 'Sam Altman',
    role: 'mentor',
    vibe: 'two-word sentences',
    regularSpots: ['agi-house'],
    xHandle: '@sama',
    encounterStyles: ['benediction'],
    tags: ['ai', 'hype', 'founder'],
    achievementHook: 'altmanned',
    ...overrides,
  }
}

function makeStory(overrides: Partial<SfStory> = {}): SfStory {
  return {
    id: 's1',
    beat: 'YC W26 founder pivots from AI sales to AI dating in 9 days',
    tone: 'absurd',
    sourceUrl: 'https://news.ycombinator.com/item?id=1',
    applicableArchetypes: ['cofounder', 'mentor'],
    tags: ['ai', 'pivot', 'yc'],
    scrapedAt: '2026-04-25T00:00:00Z',
    ...overrides,
  }
}

const PEOPLE: SfPerson[] = [
  makePerson({ id: 'sam-altman', tags: ['ai', 'hype', 'yc'] }),
  makePerson({ id: 'peter-thiel', displayName: 'Peter Thiel', role: 'vc', tags: ['fundraising', 'contrarian'], achievementHook: null, regularSpots: ['founders-fund-office'] }),
  makePerson({ id: 'paul-graham', displayName: 'Paul Graham', role: 'mentor', tags: ['mentor', 'yc'], achievementHook: null, regularSpots: ['yc-batch-house'] }),
  makePerson({ id: 'casey-newton', displayName: 'Casey Newton', role: 'reporter', tags: ['press', 'ai'], achievementHook: null, regularSpots: [] }),
  makePerson({ id: 'mike-solana', displayName: 'Mike Solana', role: 'hater', tags: ['contrarian', 'press'], achievementHook: null, regularSpots: [] }),
]

// ── Tag overlap scoring ────────────────────────────────────────────

describe('scoreEvent — tag overlap', () => {
  it('rewards events whose tags intersect flavor tags 3x more than jitter', () => {
    const flavorSet = new Set(['ai', 'hype'])
    const matching = makeEvent({ id: 'a', tags: ['ai', 'hype', 'partying'] })
    const empty = makeEvent({ id: 'b', tags: ['recruiting'] })
    const seed = 'pt-1'
    const now = REFERENCE_NOW.getTime()

    const sa = scoreEvent(matching, flavorSet, seed, now)
    const sb = scoreEvent(empty, flavorSet, seed, now)

    // tag-overlap of 2 → +6 dominates the 0..2 recency + 0..0.5 jitter spread.
    expect(sa).toBeGreaterThan(sb + 4)
  })

  it('zero overlap still has a deterministic, bounded jitter component', () => {
    const flavorSet = new Set<string>()
    const e = makeEvent({ id: 'plain', tags: ['x', 'y'] })
    const s = scoreEvent(e, flavorSet, 'seed', REFERENCE_NOW.getTime())
    // No overlap, no recency past 7d → score is just jitter ∈ [0, 0.5).
    const recency2hOut = scoreEvent(e, flavorSet, 'seed', new Date('2026-05-15T00:00:00Z').getTime())
    expect(recency2hOut).toBeGreaterThanOrEqual(0)
    expect(recency2hOut).toBeLessThan(0.5)
    // Same seed → same value.
    expect(s).toBe(scoreEvent(e, flavorSet, 'seed', REFERENCE_NOW.getTime()))
  })
})

describe('scoreStory — tag overlap', () => {
  it('matches flavor tags and penalises repeated last-episode tone', () => {
    const flavorSet = new Set(['ai', 'pivot'])
    const story = makeStory({ id: 's1', tone: 'absurd', tags: ['ai', 'pivot'] })

    const noLast = scoreStory(story, flavorSet, 'seed', undefined)
    const sameLast = scoreStory(story, flavorSet, 'seed', 'absurd')
    const diffLast = scoreStory(story, flavorSet, 'seed', 'cynical')

    expect(diffLast - sameLast).toBeCloseTo(2, 6)
    expect(noLast - sameLast).toBeCloseTo(1, 6)
  })
})

// ── Recency boost ──────────────────────────────────────────────────

describe('pickCandidateEvents — recency boost', () => {
  it('peaks at "tonight" and decays as the event drifts', () => {
    const flavorSet = new Set<string>()
    const seed = 'pt'
    const now = REFERENCE_NOW.getTime()

    const tonight = makeEvent({ id: 'tonight', startAt: '2026-04-29T22:00:00Z', tags: [] })
    const tomorrow = makeEvent({ id: 'tomorrow', startAt: '2026-04-30T20:00:00Z', tags: [] })
    const nextWeek = makeEvent({ id: 'next-week', startAt: '2026-05-05T20:00:00Z', tags: [] })

    const tScore = scoreEvent(tonight, flavorSet, seed, now)
    const dScore = scoreEvent(tomorrow, flavorSet, seed, now)
    const wScore = scoreEvent(nextWeek, flavorSet, seed, now)

    // Recency 2 (tonight) > 1.5 (tomorrow) > 0.5..1 (next week). Jitter is
    // 0..0.5 so the gaps are large enough to force this ordering.
    expect(tScore).toBeGreaterThan(dScore)
    expect(dScore).toBeGreaterThan(wScore)
  })
})

// ── Exclusion via alreadyEncountered ───────────────────────────────

describe('alreadyEncountered drops items from candidate sets', () => {
  it('excludes events whose IDs are listed', () => {
    const events = [
      makeEvent({ id: 'a', tags: ['ai'] }),
      makeEvent({ id: 'b', tags: ['ai'] }),
    ]
    const out = pickCandidateEvents(
      events,
      {
        flavorTags: ['ai'],
        stats: { hype: 0, integrity: 0 },
        alreadyEncountered: { eventIds: ['a'] },
        seed: 'pt',
        now: REFERENCE_NOW,
      },
      REFERENCE_NOW.getTime(),
    )
    expect(out.map((s) => s.event.id)).toEqual(['b'])
  })

  it('excludes stories whose IDs are listed', () => {
    const stories = [
      makeStory({ id: 's1', tags: ['ai'] }),
      makeStory({ id: 's2', tags: ['ai'] }),
    ]
    const out = pickCandidateStories(stories, {
      flavorTags: ['ai'],
      stats: { hype: 0, integrity: 0 },
      alreadyEncountered: { storyIds: ['s2'] },
      seed: 'pt',
      now: REFERENCE_NOW,
    })
    expect(out.map((s) => s.story.id)).toEqual(['s1'])
  })

  it('excludes people whose IDs are listed even when stat-bias would add them', () => {
    const events = [makeEvent({ id: 'e1', knownAttendees: [], tags: ['ai'] })]
    const candidateEvents = pickCandidateEvents(
      events,
      {
        flavorTags: ['ai'],
        stats: { hype: 5, integrity: 0 },
        alreadyEncountered: {},
        seed: 'pt',
        now: REFERENCE_NOW,
      },
      REFERENCE_NOW.getTime(),
    )

    const out = pickCandidatePeople(PEOPLE, candidateEvents, {
      flavorTags: ['ai', 'hype'],
      stats: { hype: 5, integrity: 0 },
      alreadyEncountered: { peopleIds: ['sam-altman'] },
      seed: 'pt',
      now: REFERENCE_NOW,
    })
    expect(out.find((s) => s.person.id === 'sam-altman')).toBeUndefined()
  })
})

// ── Stat bias: sam-altman at hype ≥ 4 ───────────────────────────────

describe('stat-bias rules', () => {
  it('boosts sam-altman to top of people candidates when hype ≥ 4', () => {
    const events: SfEvent[] = [
      makeEvent({ id: 'e1', tags: ['ai'], knownAttendees: ['paul-graham', 'casey-newton'] }),
    ]
    const seed = 'pt'

    const baseInput = {
      flavorTags: ['press', 'mentor'], // deliberately *don't* include ai/hype so altman scores low without the bias
      alreadyEncountered: {},
      seed,
      now: REFERENCE_NOW,
    }

    const candidateEventsLow = pickCandidateEvents(
      events,
      { ...baseInput, stats: { hype: 0, integrity: 0 } },
      REFERENCE_NOW.getTime(),
    )
    const candidateEventsHigh = pickCandidateEvents(
      events,
      { ...baseInput, stats: { hype: 5, integrity: 0 } },
      REFERENCE_NOW.getTime(),
    )

    const lowHype = pickCandidatePeople(PEOPLE, candidateEventsLow, {
      ...baseInput,
      stats: { hype: 0, integrity: 0 },
    })
    const highHype = pickCandidatePeople(PEOPLE, candidateEventsHigh, {
      ...baseInput,
      stats: { hype: 5, integrity: 0 },
    })

    const lowSam = lowHype.find((s) => s.person.id === 'sam-altman')
    const highSam = highHype.find((s) => s.person.id === 'sam-altman')
    // At low hype, sam may or may not be present (depends on wildcard sample).
    // At high hype, he must be present AND must be #1 (boost = +5).
    expect(highSam).toBeDefined()
    expect(highHype[0]?.person.id).toBe('sam-altman')
    if (lowSam !== undefined) {
      expect(highSam!.score).toBeGreaterThan(lowSam.score + 4)
    }
  })

  it('does not double-add sam-altman if he is already in the candidate pool', () => {
    const events: SfEvent[] = [
      makeEvent({ id: 'e1', tags: ['ai'], knownAttendees: ['sam-altman'] }),
    ]
    const candidateEvents = pickCandidateEvents(
      events,
      {
        flavorTags: ['ai'],
        stats: { hype: 5, integrity: 0 },
        alreadyEncountered: {},
        seed: 'pt',
        now: REFERENCE_NOW,
      },
      REFERENCE_NOW.getTime(),
    )
    const out = pickCandidatePeople(PEOPLE, candidateEvents, {
      flavorTags: ['ai'],
      stats: { hype: 5, integrity: 0 },
      alreadyEncountered: {},
      seed: 'pt',
      now: REFERENCE_NOW,
    })
    const samCount = out.filter((s) => s.person.id === 'sam-altman').length
    expect(samCount).toBe(1)
  })
})

// ── Determinism ─────────────────────────────────────────────────────

describe('mulberry32 determinism', () => {
  it('same seed → same picks, twice in a row', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({
        id: `e${i}`,
        tags: i % 2 === 0 ? ['ai'] : ['fundraising'],
        startAt: `2026-04-${String(29 + (i % 3)).padStart(2, '0')}T20:00:00Z`,
      }),
    )
    const stories = Array.from({ length: 14 }, (_, i) =>
      makeStory({
        id: `s${i}`,
        tags: i % 2 === 0 ? ['ai'] : ['recovery'],
        tone: ((['cynical', 'earnest', 'hype', 'absurd', 'wistful'] as const)[i % 5]),
      }),
    )

    const corpus = { events, people: PEOPLE, stories }
    const input = {
      flavorTags: ['ai', 'fundraising'],
      stats: { hype: 2, integrity: -1 },
      alreadyEncountered: {},
      seed: 'fixed-playthrough-id',
      now: REFERENCE_NOW,
    }

    const a = buildCandidateSet(corpus, input)
    const b = buildCandidateSet(corpus, input)

    expect(a.events.map((s) => s.event.id)).toEqual(b.events.map((s) => s.event.id))
    expect(a.people.map((s) => s.person.id)).toEqual(b.people.map((s) => s.person.id))
    expect(a.stories.map((s) => s.story.id)).toEqual(b.stories.map((s) => s.story.id))
  })

  it('different seeds → different orderings (at least somewhere)', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      makeEvent({ id: `e${i}`, tags: ['ai'], startAt: '2026-05-03T20:00:00Z' }),
    )
    const corpus = { events, people: PEOPLE, stories: [] }
    const a = buildCandidateSet(corpus, {
      flavorTags: ['ai'],
      stats: { hype: 0, integrity: 0 },
      alreadyEncountered: {},
      seed: 'seed-A',
      now: REFERENCE_NOW,
    })
    const b = buildCandidateSet(corpus, {
      flavorTags: ['ai'],
      stats: { hype: 0, integrity: 0 },
      alreadyEncountered: {},
      seed: 'seed-B',
      now: REFERENCE_NOW,
    })
    const aIds = a.events.map((s) => s.event.id)
    const bIds = b.events.map((s) => s.event.id)
    // The set of IDs at the top is the same (all events have identical
    // overlap+recency), but jitter forces a different *ordering* somewhere
    // along the result.
    expect(aIds).not.toEqual(bIds)
  })
})
