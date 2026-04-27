import { z } from 'zod'

const ARCHETYPE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const

const SPEAKER_VALUES = [...ARCHETYPE_VALUES, 'player', 'narrator'] as const

const dialogueLineSchema = z.object({
  speaker: z.enum(SPEAKER_VALUES),
  text: z.string().min(1).max(280),
})

const allowedDeltas = [-2, -1, 0, 1, 2] as const

const choiceSchema = z.object({
  id: z.string().min(1).max(2),
  label: z.string().refine((v) => v.split(/\s+/).filter(Boolean).length <= 8, {
    message: 'choice label must be ≤8 words',
  }),
  consequence: z.string().max(160).optional(),
  hype: z.number().refine((n) => allowedDeltas.includes(n as (typeof allowedDeltas)[number]), {
    message: 'hype must be one of -2,-1,0,1,2',
  }),
  integrity: z.number().refine((n) => allowedDeltas.includes(n as (typeof allowedDeltas)[number]), {
    message: 'integrity must be one of -2,-1,0,1,2',
  }),
})

const sceneSchema = z.object({
  id: z.number().int().min(1).max(20),
  title: z.string().min(1).max(80),
  archetype: z.enum(ARCHETYPE_VALUES),
  imagePrompt: z.string().min(10).max(220),
  dialogue: z.array(dialogueLineSchema).min(2).max(6),
  choices: z.array(choiceSchema).min(2).max(3),
  timeoutSeconds: z.number().int().min(8).max(30).default(15),
  timeoutChoiceId: z.string().min(1).max(2),
})

export const groupSchema = z.object({
  id: z.number().int().min(1).max(3),
  twistCard: z.string().min(8).max(220),
  scenes: z.array(sceneSchema).length(4),
})

export type ParsedGroup = z.infer<typeof groupSchema>

// Server-side hard clamp for stat deltas regardless of validation.
export function clampDelta(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n > 2) return 2
  if (n < -2) return -2
  return Math.round(n)
}

export function sanitizeGroup(g: ParsedGroup): ParsedGroup {
  return {
    ...g,
    scenes: g.scenes.map((s) => ({
      ...s,
      choices: s.choices.map((c) => ({
        ...c,
        hype: clampDelta(c.hype),
        integrity: clampDelta(c.integrity),
      })),
    })),
  }
}
