import { z } from 'zod'
import type { Role } from '@/lib/types'

export const ROLE_VALUES = ['vc', 'cofounder', 'reporter', 'hater', 'mentor'] as const
const SPEAKER_VALUES = [...ROLE_VALUES, 'player', 'narrator'] as const

const ROLE_SET = new Set<string>(ROLE_VALUES)
const SPEAKER_SET = new Set<string>(SPEAKER_VALUES)

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

export const MAX_DIALOGUE_CHARS_PER_BEAT = 800

const shareMomentSchema = z.object({
  title: z.string().min(1).max(60),
  blurb: z.string().min(1).max(180),
})

const castMemberSchema = z.object({
  role: z.enum(ROLE_VALUES),
  name: z.string().min(1).max(80),
  blurb: z.string().max(300).optional(),
})

/**
 * A Beat = one dialogue exchange + one choice block, returned by
 * /api/generate-scene per call. Many beats accumulate inside one
 * Scene container until the LLM marks isLastBeatOfScene.
 *
 * On beat 0 of a non-zero scene index (the "pivot point"), the LLM
 * MAY override the planned setting/cast/title/role to react to the
 * prior scene's outcome — see PIVOT AUTHORITY in prompts/scene.ts.
 * Most beats leave these fields undefined (use the plan).
 */
export const beatSchema = z
  .object({
    dialogue: z.array(dialogueLineSchema).min(2).max(6),
    choices: z.array(choiceSchema).min(2).max(3),
    timeoutSeconds: z.number().int().min(8).max(60).default(15),
    timeoutChoiceId: z.string().min(1).max(2),
    /** Set true when this beat closes the scene's arc. */
    isLastBeatOfScene: z.boolean().default(false),
    /** Set true when this is the LAST scene's last beat — triggers
     *  next-episode-gen on choice click. */
    isLastSceneOfEpisode: z.boolean().nullable().optional(),
    shareMoment: shareMomentSchema.optional(),
    /** Pivot overrides — only set on beat 0 of new scenes when the
     *  prior scene's outcome made the planned scene incoherent. */
    setting: z.string().min(8).max(600).nullable().optional(),
    cast: z.array(castMemberSchema).min(1).max(6).nullable().optional(),
    role: z.enum(ROLE_VALUES).nullable().optional(),
    title: z.string().min(1).max(120).nullable().optional(),
  })
  .refine(
    (s) => s.dialogue.reduce((acc, l) => acc + l.text.length, 0) <= MAX_DIALOGUE_CHARS_PER_BEAT,
    { message: `dialogue total must be ≤${MAX_DIALOGUE_CHARS_PER_BEAT} chars (TTS budget)` },
  )

export type ParsedBeat = z.infer<typeof beatSchema>

// Back-compat aliases — many callsites import `sceneSchema` /
// `MAX_DIALOGUE_CHARS_PER_SCENE`. Kept as re-exports so the rewrite
// doesn't ripple.
export const sceneSchema = beatSchema
export const MAX_DIALOGUE_CHARS_PER_SCENE = MAX_DIALOGUE_CHARS_PER_BEAT
export type ParsedScene = ParsedBeat

export function clampDelta(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n > 2) return 2
  if (n < -2) return -2
  return Math.round(n)
}

const MAX_CHOICE_CONSEQUENCE = 160
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
  if (t.includes(',') || t.length > 24) return defaultRole
  if (lower.includes('narrator')) return 'narrator'
  if (lower.includes('player') || lower === 'founder' || lower === 'you')
    return 'player'
  return defaultRole
}

export interface CoerceBeatOptions {
  primaryRole: Role
  allowedRoles?: ReadonlyArray<Role>
}

export function coerceRawBeatJson(data: unknown, opts: CoerceBeatOptions): unknown {
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
      speaker: normalizeDialogueSpeaker(d.speaker, opts.primaryRole),
    }))
    out.dialogue = fitDialogueToBudget(lines, MAX_DIALOGUE_CHARS_PER_BEAT, MAX_DIALOGUE_LINE_CHARS)
  }

  // Schema's isLastBeatOfScene defaults to false; coerce non-boolean
  // emissions accordingly.
  if (out.isLastBeatOfScene !== undefined && typeof out.isLastBeatOfScene !== 'boolean') {
    out.isLastBeatOfScene =
      out.isLastBeatOfScene === 'true' || out.isLastBeatOfScene === 1
  }

  return out
}

export const coerceRawSceneJson = coerceRawBeatJson

export function sanitizeBeat(b: ParsedBeat, opts: { allowedRoles?: ReadonlyArray<Role> } = {}): ParsedBeat {
  const dialogue = b.dialogue.filter((d) => d.text.trim().length > 0)
  const allowed: ReadonlySet<string> = opts.allowedRoles
    ? new Set(['player', 'narrator', ...opts.allowedRoles])
    : SPEAKER_SET
  const clamped = dialogue.map((d) =>
    allowed.has(d.speaker) ? d : { ...d, speaker: 'narrator' as const },
  )
  return {
    ...b,
    dialogue: clamped.length > 0 ? clamped : b.dialogue,
    choices: b.choices.map((c) => ({
      ...c,
      hype: clampDelta(c.hype),
      integrity: clampDelta(c.integrity),
    })),
  }
}

export const sanitizeScene = sanitizeBeat
