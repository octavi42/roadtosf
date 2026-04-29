import { z } from 'zod'

export const ROLE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const

const castMemberSchema = z.object({
  role: z.enum(ROLE_VALUES),
  name: z.string().min(1).max(80),
  blurb: z.string().max(300).optional(),
})

const scenePlanSchema = z.object({
  index: z.number().int().min(0).max(20),
  role: z.enum(ROLE_VALUES),
  // Caps are generous on purpose — Sonnet routinely overruns narrower
  // limits with player-specific texture, and a single overrun forces
  // the whole episode to fall back. Same lesson as the prior schema
  // bumps (premise 280→1200, beat 400→800).
  setting: z.string().min(8).max(800),
  cast: z.array(castMemberSchema).min(1).max(6),
  topic: z.string().min(8).max(800),
  imagePrompt: z.string().min(10).max(800),
  title: z.string().min(1).max(160),
})

/**
 * Episode skeleton: theme + premise + episode-level cast roster +
 * 3–5 pre-planned scenes (setting / cast subset / imagePrompt / topic
 * / title locked per scene). Images for all scenes are generated in
 * parallel by the client when this skeleton lands. Each scene plays
 * as a stream of beats (dialogue + choices) inside one container —
 * see /api/generate-scene for the per-beat shape.
 */
export const episodePlanSchema = z.object({
  episodeIndex: z.number().int().min(0).max(50).default(0),
  theme: z.string().min(4).max(240),
  premise: z.string().min(10).max(1200),
  cast: z.array(castMemberSchema).min(2).max(8),
  scenes: z.array(scenePlanSchema).min(3).max(5),
  // No min — Sonnet emits "" on episode 0 (no prior story to
  // summarize). Empty / short strings are fine; only the max matters.
  storySoFar: z.string().max(1500).nullable().optional(),
  seedIds: z.array(z.string()).default([]),
})

export type ParsedEpisodePlan = z.infer<typeof episodePlanSchema>
export type ParsedScenePlan = z.infer<typeof scenePlanSchema>
