import { z } from 'zod'

export const ROLE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const

const castMemberSchema = z.object({
  role: z.enum(ROLE_VALUES),
  name: z.string().min(1).max(80),
  blurb: z.string().max(220).optional(),
})

export const scenePlanSchema = z.object({
  index: z.number().int().min(0).max(20),
  role: z.enum(ROLE_VALUES),
  // Caps are generous on purpose — Sonnet routinely emits 600+ char
  // beats and 400+ char settings with player-specific texture, and
  // narrow caps were forcing the entire episode to fall back to the
  // canned JSON. Same lesson as the old arc-gen schema (premise cap
  // 280 → 600). nullable() accepts Sonnet's explicit-null for
  // optional fields.
  setting: z.string().min(8).max(600),
  /** Full speaker roster for this scene — primary role plus anyone
   *  the player might call, anyone who might walk in, etc. The
   *  planner pre-names them all so within-scene branching never
   *  needs to invent a new character mid-round. */
  cast: z.array(castMemberSchema).min(1).max(6),
  beat: z.string().min(8).max(800),
  kind: z.enum(['encounter', 'solo', 'world-event']).nullable().optional(),
  imagePrompt: z.string().min(10).max(600),
  /** Number of dialogue rounds in this scene. Each round = one
   *  dialogue exchange + one choice block. The whole scene shares
   *  setting + cast + imagePrompt; only dialogue + choices vary
   *  per round, branching on the player's choices. */
  roundCount: z.number().int().min(2).max(4).default(3),
})

export const episodePlanSchema = z.object({
  episodeIndex: z.number().int().min(0).max(50).default(0),
  theme: z.string().min(4).max(240),
  premise: z.string().min(10).max(1200),
  scenes: z.array(scenePlanSchema).min(3).max(5),
  storySoFar: z.string().min(20).max(1500).nullable().optional(),
  seedIds: z.array(z.string()).default([]),
})

export type ParsedScenePlan = z.infer<typeof scenePlanSchema>
export type ParsedEpisodePlan = z.infer<typeof episodePlanSchema>
