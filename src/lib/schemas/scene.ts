import { z } from 'zod'

const ARCHETYPE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const
const SPEAKER_VALUES = [...ARCHETYPE_VALUES, 'player', 'narrator'] as const

/** Per-line cap in schema / coercion (prompt asks for shorter lines; model often exceeds). */
export const MAX_DIALOGUE_LINE_CHARS = 320

const dialogueLineSchema = z.object({
  speaker: z.enum(SPEAKER_VALUES),
  // text can be empty for "(silent reaction)" beats from player/narrator;
  // sanitizeScene strips them before rendering.
  text: z.string().max(MAX_DIALOGUE_LINE_CHARS),
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

// Total dialogue char budget per scene. BUSINESS.md target was 350 (TTS lever
// #1) but Sonnet/Haiku naturally write 400-500 char scenes for comic pacing.
// Setting at 600 — ~70% over the BUSINESS.md target — to keep generation
// reliable. Phase 2 (credit-aware UI) is the right place to push this back
// down by making the cost surface to the player.
export const MAX_DIALOGUE_CHARS_PER_SCENE = 600

export const sceneSchema = z
  .object({
    id: z.number().int().min(1).max(50),
    title: z.string().min(1).max(120),
    archetype: z.enum(ARCHETYPE_VALUES),
    imagePrompt: z.string().min(10).max(500),
    dialogue: z.array(dialogueLineSchema).min(2).max(6),
    choices: z.array(choiceSchema).min(2).max(3),
    timeoutSeconds: z.number().int().min(8).max(60).default(15),
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

const MAX_CHOICE_CONSEQUENCE = 160
const MAX_IMAGE_PROMPT = 500
const MAX_TITLE = 120
const TIMEOUT_MIN = 8
const TIMEOUT_MAX = 60

function dialogueCharTotal(lines: Array<Record<string, unknown>>): number {
  return lines.reduce((acc, d) => {
    const t = d.text
    return acc + (typeof t === 'string' ? t.length : 0)
  }, 0)
}

/** Shrink dialogue so total chars ≤ budget without dropping lines (trim from the end of lines). */
function fitDialogueToBudget(
  dialogue: Array<Record<string, unknown>>,
  budget: number,
  lineCap: number,
): Array<Record<string, unknown>> {
  const lines = dialogue.map((d) => {
    const text = typeof d.text === 'string' ? d.text : ''
    return { ...d, text: text.slice(0, lineCap) }
  })
  let total = dialogueCharTotal(lines)
  let i = lines.length - 1
  while (total > budget && i >= 0) {
    const over = total - budget
    const t = typeof lines[i].text === 'string' ? lines[i].text : ''
    if (t.length <= 1) {
      i--
      continue
    }
    const cut = Math.min(over, t.length - 1)
    lines[i] = { ...lines[i], text: t.slice(0, t.length - cut) }
    total -= cut
  }
  return lines
}

/**
 * Normalizes common LLM overshoots so Zod validation succeeds. Keeps gameplay on the LLM path
 * instead of falling back when the model is slightly over TTS / field limits.
 */
export function coerceRawSceneJson(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const o = data as Record<string, unknown>
  const out: Record<string, unknown> = { ...o }

  if (typeof out.timeoutSeconds === 'number' && Number.isFinite(out.timeoutSeconds)) {
    const n = Math.round(out.timeoutSeconds)
    out.timeoutSeconds = Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, n))
  } else if (typeof out.timeoutSeconds === 'string') {
    const n = parseInt(out.timeoutSeconds, 10)
    if (!Number.isNaN(n)) {
      out.timeoutSeconds = Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, n))
    }
  }

  if (typeof out.title === 'string' && out.title.length > MAX_TITLE) {
    out.title = out.title.slice(0, MAX_TITLE).trimEnd()
  }

  if (typeof out.imagePrompt === 'string' && out.imagePrompt.length > MAX_IMAGE_PROMPT) {
    out.imagePrompt = out.imagePrompt.slice(0, MAX_IMAGE_PROMPT).trimEnd()
  }

  if (Array.isArray(out.choices)) {
    out.choices = out.choices.map((c) => {
      if (!c || typeof c !== 'object') return c
      const ch = { ...(c as Record<string, unknown>) }
      if (typeof ch.label === 'string') {
        const words = ch.label.split(/\s+/).filter(Boolean)
        if (words.length > 8) ch.label = words.slice(0, 8).join(' ')
      }
      if (typeof ch.consequence === 'string' && ch.consequence.length > MAX_CHOICE_CONSEQUENCE) {
        ch.consequence = ch.consequence.slice(0, MAX_CHOICE_CONSEQUENCE).trimEnd()
      }
      return ch
    })
  }

  if (Array.isArray(out.dialogue)) {
    out.dialogue = fitDialogueToBudget(
      out.dialogue.filter((d) => d && typeof d === 'object') as Array<Record<string, unknown>>,
      MAX_DIALOGUE_CHARS_PER_SCENE,
      MAX_DIALOGUE_LINE_CHARS,
    )
  }

  return out
}

export function sanitizeScene(s: ParsedScene): ParsedScene {
  // Strip empty-text dialogue lines (LLM sometimes uses them for "silent
  // beats"; the renderer can't display them as voiced lines).
  const dialogue = s.dialogue.filter((d) => d.text.trim().length > 0)
  return {
    ...s,
    dialogue: dialogue.length > 0 ? dialogue : s.dialogue, // never strip everything
    choices: s.choices.map((c) => ({
      ...c,
      hype: clampDelta(c.hype),
      integrity: clampDelta(c.integrity),
    })),
  }
}
