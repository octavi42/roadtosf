import { z } from 'zod'

const ARCHETYPE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const

export const sceneOutlineSchema = z.object({
  index: z.number().int().min(0).max(20),
  archetype: z.enum(ARCHETYPE_VALUES),
  beat: z.string().min(8).max(400),
  // Sonnet 4.6 emits explicit `null` instead of omitting optional fields, so
  // accept null here. Downstream readers already short-circuit on falsy.
  hingesOn: z.string().max(280).nullable().optional(),
  // Storylet kind: encounter (default) | solo | world-event. Solo and
  // world-event scenes render with narrator + player only — no NPC of
  // the assigned archetype speaks.
  kind: z.enum(['encounter', 'solo', 'world-event']).optional(),
})

export const arcSkeletonSchema = z.object({
  episodeIndex: z.number().int().min(0).max(50).default(0),
  premise: z.string().min(10).max(280),
  scenes: z.array(sceneOutlineSchema).length(5),
  // Prompt asks for ~200 words (≈1000–1500 chars). The 700 cap was rejecting
  // legitimate Sonnet output by episode 1, forcing a 37s retry-then-fallback
  // chain that landed the skeleton after the player had already advanced past
  // the new episode boundary.
  storySoFar: z.string().min(20).max(1500).optional(),
})

export type ParsedArcSkeleton = z.infer<typeof arcSkeletonSchema>
