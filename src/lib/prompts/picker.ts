import type { CandidateSet } from '@/lib/lore/candidates'

// Stage 2 prompt for the lore-picker (LORE_SYSTEM.md §3.2). Mirrors the
// system+user blocks pattern in src/lib/prompts/arc.ts. The system block
// is cached because it's static across a playthrough and ~700 tokens —
// caching is worth ~1¢ over a 5-episode run.

export interface BuildPickerPromptInput {
  episodeIndex: number
  /** Player's flavor tags from the intro extractor. */
  flavorTags: string[]
  stats: { hype: number; integrity: number }
  /** "@arc.storySoFar" if present, else short stub. */
  storySoFar: string
  /** ID lists: things the picker MUST avoid re-recommending. */
  alreadyEncountered: {
    eventIds?: string[]
    peopleIds?: string[]
    storyIds?: string[]
  }
  /** Optional: most recent player choice label, used as bias signal. */
  lastChoiceLabel?: string
  /** Stage 1 candidate pool — already filtered, scored, and capped. */
  candidates: CandidateSet
}

const SYSTEM_RULES = `You are the lore-curator for "Road to SF", a satirical SF founder game. You receive a candidate pool of REAL SF events, REAL people, and SCRAPED anecdotes, and you pick the tightest set for ONE 5-scene episode.

YOUR JOB:
- Pick 1-2 EVENTS, 0-1 NAMED CAMEO, 1-2 STORIES from the candidate pool.
- Return JSON IDs only — never invent names, never write content, never compose dialogue.
- The cameo MUST plausibly be at one of the picked events (matched via known_attendees overlap with the event, or via regular_spots overlap with the venue). If no plausible cameo exists, return an empty peopleIds array — better none than incoherent.
- Bias toward picks that EXPLOIT the player's most recent choice and the current stat trajectory.
- AVOID picks listed under "## ALREADY ENCOUNTERED" — those are the player's history; re-introducing them breaks continuity.
- ABSOLUTE RULE: every ID you emit MUST appear in the candidate pool I gave you. Do not hallucinate IDs. Server-side validation will drop unknown IDs and treat that as a bug.

OUTPUT (single JSON object, no prose, no fences. Start with "{" end with "}"):
{
  "eventIds": [string, ...],   // 1-2 IDs from CANDIDATE EVENTS
  "peopleIds": [string, ...],  // 0-1 IDs from CANDIDATE PEOPLE
  "storyIds": [string, ...],   // 1-2 IDs from CANDIDATE STORIES
  "rationale": string          // ≤120 chars, why these picks fit this player THIS episode
}

PICKING HEURISTICS:
- Prefer events whose tags overlap the player's flavor tags AND whose start_at is near (today/tonight beats next week).
- Prefer a cameo whose archetype + tags fit the chosen event's vibe. A reporter at a launch demo > a VC at a recovery brunch.
- Prefer stories whose tone CONTRASTS the last episode's tone (the system already nudges this; don't re-nudge).
- Stat-bias: at hype ≥ 4, the system has already injected sam-altman as a candidate — choose him only if the chosen event makes sense for his archetype (mentor / oracle).
- If candidate pools are thin, ship fewer picks rather than reaching. Empty arrays are valid.

YOU NEVER:
- Write dialogue, beats, or scene content. The arc-gen does that with your IDs.
- Add fields outside the schema. The validator rejects unknown keys.
- Pick more than the caps (server clips silently but logs).`

function fmtList<T>(items: T[], render: (it: T) => string, empty = '(none)'): string {
  if (items.length === 0) return empty
  return items.map(render).join('\n')
}

function fmtIds(ids: string[] | undefined): string {
  if (!ids || ids.length === 0) return '(none)'
  return ids.map((id) => `- ${id}`).join('\n')
}

export function buildPickerPromptParts(input: BuildPickerPromptInput) {
  const eventLines = fmtList(input.candidates.events, ({ event }) => {
    const date = event.startAt.slice(0, 16).replace('T', ' ')
    const tags = event.tags.length ? ` [${event.tags.join(', ')}]` : ''
    const att = event.knownAttendees.length
      ? ` known_attendees: ${event.knownAttendees.join(', ')}`
      : ''
    const blurb = event.blurb ? ` — ${event.blurb}` : ''
    return `- ${event.id} | ${date} UTC | ${event.name} @ ${event.venue}${tags}${att}${blurb}`
  })

  const peopleLines = fmtList(input.candidates.people, ({ person }) => {
    const tags = person.tags.length ? ` [${person.tags.join(', ')}]` : ''
    const styles = person.encounterStyles.length ? ` (modes: ${person.encounterStyles.join(', ')})` : ''
    return `- ${person.id} | ${person.displayName} (${person.role})${tags}${styles} — ${person.vibe}`
  })

  const storyLines = fmtList(input.candidates.stories, ({ story }) => {
    const tags = story.tags.length ? ` [${story.tags.join(', ')}]` : ''
    const arches = story.applicableArchetypes.length
      ? ` arch: ${story.applicableArchetypes.join('/')}`
      : ''
    return `- ${story.id} | ${story.tone}${arches}${tags} — ${story.beat}`
  })

  const userBlock = `## PLAYER STATE
Episode index: ${input.episodeIndex}
Flavor tags: ${input.flavorTags.length ? input.flavorTags.join(', ') : '(none)'}
Stats — hype ${input.stats.hype}, integrity ${input.stats.integrity}
Last choice: ${input.lastChoiceLabel ?? '(opening — no prior choice)'}

## STORY SO FAR
${input.storySoFar.trim().length > 0 ? input.storySoFar.trim() : '(opening episode — no prior story)'}

## ALREADY ENCOUNTERED (do NOT re-pick)
events:
${fmtIds(input.alreadyEncountered.eventIds)}
people:
${fmtIds(input.alreadyEncountered.peopleIds)}
stories:
${fmtIds(input.alreadyEncountered.storyIds)}

## CANDIDATE EVENTS (pick 1-2 IDs)
${eventLines}

## CANDIDATE PEOPLE (pick 0-1 IDs; must plausibly fit the chosen event)
${peopleLines}

## CANDIDATE STORIES (pick 1-2 IDs)
${storyLines}

## TASK
Pick the tightest set for this episode. Return the JSON object now.`

  return {
    systemBlocks: [{ text: SYSTEM_RULES, cache: true as const }],
    userBlocks: [{ text: userBlock, cache: false as const }],
  }
}
