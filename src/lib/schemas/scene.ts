import { z } from 'zod'

const ARCHETYPE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const
const SPEAKER_VALUES = [...ARCHETYPE_VALUES, 'player', 'narrator'] as const

const dialogueLineSchema = z.object({
  speaker: z.enum(SPEAKER_VALUES),
  text: z.string().min(1).max(160),
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

// Total dialogue char budget per scene — caps TTS cost (BUSINESS.md lever #1).
export const MAX_DIALOGUE_CHARS_PER_SCENE = 350

export const sceneSchema = z
  .object({
    id: z.number().int().min(1).max(20),
    title: z.string().min(1).max(80),
    archetype: z.enum(ARCHETYPE_VALUES),
    imagePrompt: z.string().min(10).max(220),
    dialogue: z.array(dialogueLineSchema).min(2).max(4),
    choices: z.array(choiceSchema).min(2).max(3),
    timeoutSeconds: z.number().int().min(8).max(30).default(15),
    timeoutChoiceId: z.string().min(1).max(2),
  })
  .refine(
    (s) => s.dialogue.reduce((acc, l) => acc + l.text.length, 0) <= MAX_DIALOGUE_CHARS_PER_SCENE,
    { message: `dialogue total must be ≤${MAX_DIALOGUE_CHARS_PER_SCENE} chars (TTS budget)` },
  )

export type ParsedScene = z.infer<typeof sceneSchema>

export function clampDelta(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n > 2) return 2
  if (n < -2) return -2
  return Math.round(n)
}

export function sanitizeScene(s: ParsedScene): ParsedScene {
  return {
    ...s,
    choices: s.choices.map((c) => ({
      ...c,
      hype: clampDelta(c.hype),
      integrity: clampDelta(c.integrity),
    })),
  }
}
