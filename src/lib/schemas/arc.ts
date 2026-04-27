import { z } from 'zod'

const ARCHETYPE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const

export const sceneOutlineSchema = z.object({
  index: z.number().int().min(0).max(20),
  archetype: z.enum(ARCHETYPE_VALUES),
  beat: z.string().min(8).max(220),
  hingesOn: z.string().max(200).optional(),
})

export const arcSkeletonSchema = z.object({
  episodeIndex: z.number().int().min(0).max(50).default(0),
  premise: z.string().min(10).max(280),
  scenes: z.array(sceneOutlineSchema).length(5),
  storySoFar: z.string().min(20).max(700).optional(),
})

export type ParsedArcSkeleton = z.infer<typeof arcSkeletonSchema>
