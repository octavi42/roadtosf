import { z } from 'zod'

// Picker output shape (LORE_SYSTEM.md §3.2). Haiku returns this object;
// Stage 3 server validation (the validator below) drops hallucinated IDs
// before the result is hydrated and shipped to the arc-gen route.

export const pickerOutputSchema = z.object({
  eventIds: z.array(z.string().min(1).max(120)).max(8),
  peopleIds: z.array(z.string().min(1).max(120)).max(4),
  storyIds: z.array(z.string().min(1).max(120)).max(8),
  // ≤120 chars per spec, but Haiku occasionally over-shoots. 240 is the
  // hard cap; we still slice to 120 in the route to keep logs readable.
  rationale: z.string().max(240).default(''),
})

export type PickerOutput = z.infer<typeof pickerOutputSchema>

// Caps from LORE_SYSTEM.md §3.3 (server enforces, not the LLM).
export const PICK_CAPS = {
  events: 2,
  people: 1,
  stories: 2,
} as const

export interface CandidateIdSets {
  eventIds: Set<string>
  peopleIds: Set<string>
  storyIds: Set<string>
}

export interface ValidatedPicks {
  eventIds: string[]
  peopleIds: string[]
  storyIds: string[]
  rationale: string
  /** IDs the LLM emitted that did not match the candidate pool — logged not thrown. */
  dropped: { eventIds: string[]; peopleIds: string[]; storyIds: string[] }
}

// Stage 3: drop any IDs not in the candidate pool, dedupe in-array
// duplicates, and enforce per-dataset caps. Pure — same input → same output.
export function validatePicks(raw: PickerOutput, allowed: CandidateIdSets): ValidatedPicks {
  const dropped = { eventIds: [] as string[], peopleIds: [] as string[], storyIds: [] as string[] }

  function clean(ids: string[], allowedSet: Set<string>, bucket: string[], cap: number): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      if (!allowedSet.has(id)) {
        bucket.push(id)
        continue
      }
      out.push(id)
      if (out.length >= cap) break
    }
    return out
  }

  return {
    eventIds: clean(raw.eventIds, allowed.eventIds, dropped.eventIds, PICK_CAPS.events),
    peopleIds: clean(raw.peopleIds, allowed.peopleIds, dropped.peopleIds, PICK_CAPS.people),
    storyIds: clean(raw.storyIds, allowed.storyIds, dropped.storyIds, PICK_CAPS.stories),
    rationale: raw.rationale.slice(0, 120),
    dropped,
  }
}
