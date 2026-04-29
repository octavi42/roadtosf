import { z } from 'zod'

export const ROLE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const

const castMemberSchema = z.object({
  role: z.enum(ROLE_VALUES),
  name: z.string().min(1).max(80),
  blurb: z.string().max(300).optional(),
})

/**
 * Episode skeleton. Lightweight — theme, premise, cast roster, and a
 * loose arc. Scenes are NOT pre-planned; they are invented by Haiku
 * scene-by-scene at scene-gen time. The skeleton just commits to the
 * episode-level container (who could appear, what kind of arc).
 */
export const episodePlanSchema = z.object({
  episodeIndex: z.number().int().min(0).max(50).default(0),
  theme: z.string().min(4).max(240),
  premise: z.string().min(10).max(1200),
  /** Full speaker roster for the episode — anyone who might appear
   *  in any scene. Scene-gen MUST pick from this list. */
  cast: z.array(castMemberSchema).min(2).max(8),
  /** Loose arc bullets (3–5). Hints for the scene-gen prompt — NOT
   *  per-scene plans. Each scene is generated on the fly. */
  arcBullets: z.array(z.string().min(8).max(400)).min(3).max(8),
  storySoFar: z.string().min(20).max(1500).nullable().optional(),
  seedIds: z.array(z.string()).default([]),
})

export type ParsedEpisodePlan = z.infer<typeof episodePlanSchema>
