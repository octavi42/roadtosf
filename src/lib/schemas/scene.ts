import { z } from 'zod'
import type { Role } from '@/lib/types'

export const ROLE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const
const SPEAKER_VALUES = [...ROLE_VALUES, 'player', 'narrator'] as const

const ROLE_SET = new Set<string>(ROLE_VALUES)
const SPEAKER_SET = new Set<string>(SPEAKER_VALUES)

/** Per-line cap in schema / coercion. */
export const MAX_DIALOGUE_LINE_CHARS = 320

const dialogueLineSchema = z.object({
  speaker: z.enum(SPEAKER_VALUES),
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

export const MAX_DIALOGUE_CHARS_PER_SCENE = 800

const shareMomentSchema = z.object({
  title: z.string().min(1).max(60),
  blurb: z.string().min(1).max(180),
})

const castMemberSchema = z.object({
  role: z.enum(ROLE_VALUES),
  name: z.string().min(1).max(80),
  blurb: z.string().max(300).optional(),
})

export const sceneSchema = z
  .object({
    id: z.number().int().min(1).max(9999),
    title: z.string().min(1).max(120),
    role: z.enum(ROLE_VALUES),
    /** Concrete setting Haiku invented for THIS scene. */
    setting: z.string().min(8).max(600).nullable().optional(),
    /** Subset of episode cast appearing in THIS scene. Picked by
     *  Haiku based on the prior choice. */
    cast: z.array(castMemberSchema).max(6).optional(),
    /** True on the scene that closes the episode arc. Triggers next
     *  /api/generate-episode call client-side. */
    isLastSceneOfEpisode: z.boolean().nullable().optional(),
    imagePrompt: z.string().min(10).max(600),
    dialogue: z.array(dialogueLineSchema).min(2).max(6),
    choices: z.array(choiceSchema).min(2).max(3),
    timeoutSeconds: z.number().int().min(8).max(60).default(15),
    timeoutChoiceId: z.string().min(1).max(2),
    shareMoment: shareMomentSchema.optional(),
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

function snapTrim(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  if (maxLen <= 0) return text.slice(0, 1)
  const slice = text.slice(0, maxLen)
  const sentenceBoundary = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  )
  if (sentenceBoundary > 0) return slice.slice(0, sentenceBoundary + 1)
  const wordBoundary = slice.lastIndexOf(' ')
  if (wordBoundary > 0) return slice.slice(0, wordBoundary).trimEnd()
  return slice
}

function fitDialogueToBudget(
  dialogue: Array<Record<string, unknown>>,
  budget: number,
  lineCap: number,
): Array<Record<string, unknown>> {
  const lines = dialogue.map((d) => {
    const text = typeof d.text === 'string' ? d.text : ''
    return { ...d, text: snapTrim(text, lineCap) }
  })
  let total = dialogueCharTotal(lines)
  let i = lines.length - 1
  while (total > budget && i >= 0) {
    const t = typeof lines[i].text === 'string' ? lines[i].text : ''
    if (t.length <= 1) {
      i--
      continue
    }
    const targetLen = Math.max(1, t.length - (total - budget))
    const trimmed = snapTrim(t, targetLen)
    const cut = t.length - trimmed.length
    if (cut <= 0) {
      i--
      continue
    }
    lines[i] = { ...lines[i], text: trimmed }
    total -= cut
  }
  return lines
}

function normalizeDialogueSpeaker(raw: unknown, defaultRole: Role): string {
  if (typeof raw !== 'string') return defaultRole
  const t = raw.trim()
  const lower = t.toLowerCase()
  if (SPEAKER_SET.has(lower)) return lower
  // Multi-role scenes allow any role from the cast — but if the model
  // emits a free-form display string, we can't reverse-map without the
  // cast. Fall back to the scene's primary role.
  if (t.includes(',') || t.length > 24) return defaultRole
  if (lower.includes('narrator')) return 'narrator'
  if (lower.includes('player') || lower === 'founder' || lower === 'you')
    return 'player'
  return defaultRole
}

export interface CoerceSceneOptions {
  /** Primary role from the scene plan. Used as the fallback when the
   *  model emits an unrecognized speaker — multi-role scenes still
   *  honor cofounder/vc/etc. speakers as long as they're in the
   *  ROLE_SET. */
  primaryRole: Role
  /** Cast roles allowed to speak in this scene. Speakers outside this
   *  set + player + narrator get clamped to the primary role. */
  allowedRoles?: ReadonlyArray<Role>
}

export function coerceRawSceneJson(data: unknown, opts: CoerceSceneOptions): unknown {
  if (!data || typeof data !== 'object') return data
  const o = data as Record<string, unknown>
  const out: Record<string, unknown> = { ...o }

  const primaryRole: Role = opts.primaryRole
  // Schema field is `role` now; accept either `role` (new) or
  // `archetype` (legacy LLM emissions) and pin to the primary role.
  if (typeof out.role === 'string') {
    const r = out.role.trim().toLowerCase()
    if (ROLE_SET.has(r)) out.role = r
    else out.role = primaryRole
  } else if (typeof out.archetype === 'string') {
    const r = out.archetype.trim().toLowerCase()
    if (ROLE_SET.has(r)) out.role = r
    else out.role = primaryRole
    delete out.archetype
  } else {
    out.role = primaryRole
  }

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

  if (out.shareMoment !== undefined) {
    const sm = out.shareMoment as Record<string, unknown> | null
    const trimmed =
      sm && typeof sm === 'object'
        ? {
            title: typeof sm.title === 'string' ? sm.title.trim() : sm.title,
            blurb: typeof sm.blurb === 'string' ? sm.blurb.trim() : sm.blurb,
          }
        : sm
    const parsed = shareMomentSchema.safeParse(trimmed)
    if (parsed.success) out.shareMoment = parsed.data
    else delete out.shareMoment
  }

  if (Array.isArray(out.dialogue)) {
    const lines = (
      out.dialogue.filter((d) => d && typeof d === 'object') as Array<Record<string, unknown>>
    ).map((d) => ({
      ...d,
      speaker: normalizeDialogueSpeaker(d.speaker, primaryRole),
    }))
    out.dialogue = fitDialogueToBudget(lines, MAX_DIALOGUE_CHARS_PER_SCENE, MAX_DIALOGUE_LINE_CHARS)
  }

  return out
}

export function sanitizeScene(s: ParsedScene, opts: { allowedRoles?: ReadonlyArray<Role> } = {}): ParsedScene {
  const dialogue = s.dialogue.filter((d) => d.text.trim().length > 0)
  // Cast lock: if allowedRoles is supplied (cast from the ScenePlan),
  // limit speakers to those + player + narrator. If unsupplied, allow
  // any role + player + narrator (multi-role scenes are the default).
  const allowed: ReadonlySet<string> = opts.allowedRoles
    ? new Set(['player', 'narrator', ...opts.allowedRoles])
    : SPEAKER_SET
  const clamped = dialogue.map((d) =>
    allowed.has(d.speaker) ? d : { ...d, speaker: 'narrator' as const },
  )
  return {
    ...s,
    dialogue: clamped.length > 0 ? clamped : s.dialogue,
    choices: s.choices.map((c) => ({
      ...c,
      hype: clampDelta(c.hype),
      integrity: clampDelta(c.integrity),
    })),
  }
}
