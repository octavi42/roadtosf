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
  setting: z.string().min(8).max(280),
  cast: z.array(castMemberSchema).min(1).max(6),
  beat: z.string().min(8).max(400),
  kind: z.enum(['encounter', 'solo', 'world-event']).optional(),
  imagePrompt: z.string().min(10).max(500),
})

export const episodePlanSchema = z.object({
  episodeIndex: z.number().int().min(0).max(50).default(0),
  theme: z.string().min(4).max(160),
  premise: z.string().min(10).max(800),
  scenes: z.array(scenePlanSchema).min(3).max(5),
  storySoFar: z.string().min(20).max(1500).optional(),
  seedIds: z.array(z.string()).default([]),
})

export type ParsedScenePlan = z.infer<typeof scenePlanSchema>
export type ParsedEpisodePlan = z.infer<typeof episodePlanSchema>
