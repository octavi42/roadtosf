import { NextResponse } from 'next/server'
import { streamJsonText, MODELS, extractJsonObject } from '@/lib/anthropic'
import {
  beatSchema,
  coerceRawBeatJson,
  sanitizeBeat,
  type ParsedBeat,
} from '@/lib/schemas/scene'
import { episodePlanSchema } from '@/lib/schemas/episode'
import {
  buildBeatPromptParts,
  type PriorChoiceSummary,
} from '@/lib/prompts/scene'
import type { Beat, DialogueLine, Episode, Role } from '@/lib/types'
import { getToneSpec } from '@/lib/cameos/tone'
import type { ToneId, ToneSpec } from '@/lib/cameos/types'

const AUTHORED_SCENE_COUNT = 8

type Body = {
  episode?: unknown
  episodeIndex?: unknown
  sceneIndexInEpisode?: unknown
  /** 0-based index of THIS beat within the scene's beat sequence. */
  beatIndex?: unknown
  /** Dialogue accumulated from prior beats of THIS scene only. */
  priorBeatsDialogue?: unknown
  /** The player's choice on the prior beat (within THIS scene). */
  priorBeatChoice?: unknown
  storySoFar?: unknown
  startupName?: unknown
  startupDescription?: unknown
  founderPersona?: unknown
  team?: unknown
  fundingModel?: unknown
  targetCustomer?: unknown
  concern?: unknown
  recentChoices?: unknown
  priorChoices?: unknown
  currentStats?: unknown
  playthroughId?: unknown
  tone?: unknown
}

const VALID_TONES: ReadonlySet<ToneId> = new Set([
  'paranoid-thriller',
  'hype-pilled-comedy',
  'slow-burn-tragedy',
  'delusional-mania',
  'contrarian-fable',
])

function asToneSpec(v: unknown): ToneSpec | undefined {
  if (typeof v !== 'string') return undefined
  if (!VALID_TONES.has(v as ToneId)) return undefined
  return getToneSpec(v as ToneId)
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback
}

function asPriorChoices(v: unknown): PriorChoiceSummary[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): PriorChoiceSummary[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    const sceneId = asInt(o.sceneId, NaN)
    if (Number.isNaN(sceneId)) return []
    return [
      {
        sceneId,
        choiceLabel: asString(o.choiceLabel, '(unspecified)'),
        hypeDelta: asInt(o.hypeDelta, 0),
        integrityDelta: asInt(o.integrityDelta, 0),
      },
    ]
  })
}

function asPriorBeatChoice(v: unknown): PriorChoiceSummary | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return {
    sceneId: asInt(o.sceneId, 0),
    choiceLabel: asString(o.choiceLabel, '(unspecified)'),
    hypeDelta: asInt(o.hypeDelta, 0),
    integrityDelta: asInt(o.integrityDelta, 0),
  }
}

function asPriorBeatsDialogue(v: unknown): DialogueLine[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): DialogueLine[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    const speaker = asString(o.speaker, 'narrator')
    const text = asString(o.text, '')
    if (text.trim().length === 0) return []
    return [{ speaker: speaker as DialogueLine['speaker'], text }]
  })
}

function parseFromRaw(
  raw: string,
  primaryRole: Role,
  allowedRoles: ReadonlyArray<Role>,
): ParsedBeat {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[generate-scene] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = beatSchema.safeParse(coerceRawBeatJson(json, { primaryRole, allowedRoles }))
  if (!result.success) {
    console.warn(
      '[generate-scene] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[generate-scene] payload was:', JSON.stringify(json).slice(0, 800))
    throw result.error
  }
  return sanitizeBeat(result.data, { allowedRoles })
}

// ── Incremental JSON extractors for streaming beat generation ───────
function findStringFieldEnd(text: string, key: string): number {
  const re = new RegExp(`"${key}"\\s*:\\s*"`)
  const m = re.exec(text)
  if (!m || m.index === undefined) return -1
  let i = m.index + m[0].length
  let escape = false
  while (i < text.length) {
    const c = text[i]!
    if (escape) {
      escape = false
      i++
      continue
    }
    if (c === '\\') {
      escape = true
      i++
      continue
    }
    if (c === '"') return i + 1
    i++
  }
  return -1
}

function findDialogueArrayStart(text: string): number {
  const m = text.match(/"dialogue"\s*:\s*\[/)
  if (!m || m.index === undefined) return -1
  return m.index + m[0].length
}

function nextDialogueLine(
  s: string,
  start: number,
): { value: { speaker?: string; text?: string }; end: number } | null {
  let i = start
  while (i < s.length && (s[i] === ',' || /\s/.test(s[i]!))) i++
  if (i >= s.length) return null
  if (s[i] === ']') return null
  if (s[i] !== '{') return null

  let depth = 0
  let inString = false
  let escape = false
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const slice = s.slice(i, j + 1)
        try {
          return { value: JSON.parse(slice), end: j + 1 }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

void findStringFieldEnd // currently unused — preserved for symmetry with prior version

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  let episode: Episode
  try {
    const parsed = episodePlanSchema.parse(body.episode)
    episode = { ...parsed, seedIds: parsed.seedIds ?? [] }
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid episode skeleton', detail: String(err) },
      { status: 400 },
    )
  }

  const sceneIndexInEpisode = asInt(body.sceneIndexInEpisode, 0)
  const beatIndex = asInt(body.beatIndex, 0)
  const plan = episode.scenes[sceneIndexInEpisode]
  if (!plan) {
    return NextResponse.json(
      {
        error: `no scene plan at index ${sceneIndexInEpisode} (episode has ${episode.scenes.length} scenes)`,
      },
      { status: 400 },
    )
  }

  const isFinalSceneOfEpisode =
    sceneIndexInEpisode === episode.scenes.length - 1

  const sceneId =
    AUTHORED_SCENE_COUNT +
    asInt(body.episodeIndex, episode.episodeIndex) * 8 +
    sceneIndexInEpisode +
    1

  // Cast pool widens at beat 0 of scenes >0: scene-gen has authority
  // to pivot the planned scene if the prior scene's outcome made it
  // incoherent (e.g. player walked away from the planned cast member).
  // The episode-level roster is the closed set; the planned scene's
  // cast is the strong default. Mid-scene beats (beatIndex>0) keep the
  // tighter cast lock because the scene's already in motion.
  const isFirstBeatOfNewScene = beatIndex === 0 && sceneIndexInEpisode > 0
  const allowedRoles: Role[] = isFirstBeatOfNewScene
    ? Array.from(new Set<Role>(episode.cast.map((c) => c.role as Role).concat(plan.role)))
    : Array.from(new Set<Role>(plan.cast.map((c) => c.role as Role).concat(plan.role)))
  const primaryRole: Role = plan.role

  const promptInput = {
    episode,
    sceneIndexInEpisode,
    beatIndex,
    priorBeatsDialogue: asPriorBeatsDialogue(body.priorBeatsDialogue),
    priorBeatChoice: asPriorBeatChoice(body.priorBeatChoice),
    sceneId,
    storySoFar: asString(body.storySoFar, '') || undefined,
    startupName: asString(body.startupName, 'the startup'),
    founderPersona: asString(body.founderPersona, ''),
    team: asString(body.team, '') || undefined,
    fundingModel: asString(body.fundingModel, '') || undefined,
    targetCustomer: asString(body.targetCustomer, '') || undefined,
    concern: asString(body.concern, '') || undefined,
    recentChoices: asPriorChoices(body.recentChoices ?? body.priorChoices),
    currentStats: {
      hype: asInt((body.currentStats as Record<string, unknown> | undefined)?.hype, 0),
      integrity: asInt(
        (body.currentStats as Record<string, unknown> | undefined)?.integrity,
        0,
      ),
    },
    tone: asToneSpec(body.tone),
    isFinalSceneOfEpisode,
  }

  const { systemBlocks, userBlocks } = buildBeatPromptParts(promptInput)

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(name, data)))
      }

      const sendFallback = () => {
        // Fallback beat — a generic exchange that lets the player keep
        // playing if the LLM path failed.
        const speaker: Role = primaryRole
        const fallbackBeat: Beat = {
          dialogue: [
            { speaker: 'narrator', text: 'A long pause. The room is the same.' },
            { speaker, text: 'So. What now?' },
          ],
          choices: [
            { id: 'a', label: 'Lean in.', hype: 1, integrity: -1 },
            { id: 'b', label: 'Hold the line.', hype: 0, integrity: 1 },
          ],
          timeoutSeconds: 15,
          timeoutChoiceId: 'b',
          isLastBeatOfScene: false,
          isLastSceneOfEpisode: false,
        }
        send('done', {
          beat: fallbackBeat,
          sceneId,
          source: 'fallback' as const,
          creditsRemaining: null,
        })
      }

      try {
        if (!process.env.ANTHROPIC_API_KEY)
          throw new Error('ANTHROPIC_API_KEY missing')

        let dialogueArrayStart = -1
        let nextDialogueSearchPos = 0
        let dialogueLinesFired = 0

        const tryEmitProgress = (full: string) => {
          if (dialogueArrayStart === -1) {
            dialogueArrayStart = findDialogueArrayStart(full)
            if (dialogueArrayStart !== -1) nextDialogueSearchPos = dialogueArrayStart
          }
          if (dialogueArrayStart !== -1) {
            while (dialogueLinesFired < 8) {
              const line = nextDialogueLine(full, nextDialogueSearchPos)
              if (!line) break
              nextDialogueSearchPos = line.end
              dialogueLinesFired++
              const speaker =
                typeof line.value.speaker === 'string' ? line.value.speaker : 'narrator'
              const text = typeof line.value.text === 'string' ? line.value.text : ''
              if (text.length > 0) {
                send('dialogueLine', { index: dialogueLinesFired - 1, speaker, text })
              }
            }
          }
        }

        const raw = await streamJsonText({
          model: MODELS.scene,
          systemBlocks,
          userBlocks,
          maxTokens: 900,
          temperature: 0.85,
          onText: (_delta, full) => tryEmitProgress(full),
          signal: request.signal,
        })

        const parsed = parseFromRaw(raw, primaryRole, allowedRoles)
        // Force isLastSceneOfEpisode = false on non-final scenes (LLM
        // ignores the rule sometimes).
        const beat: Beat = {
          ...parsed,
          isLastSceneOfEpisode: isFinalSceneOfEpisode
            ? !!parsed.isLastSceneOfEpisode
            : false,
        }
        send('done', {
          beat,
          sceneId,
          source: 'llm' as const,
          creditsRemaining: null,
        })
      } catch (err) {
        console.warn(
          `generate-scene episode=${episode.episodeIndex} scene=${sceneIndexInEpisode} beat=${beatIndex}: LLM path failed, sending fallback`,
          err,
        )
        try {
          sendFallback()
        } catch (fallbackErr) {
          console.error('generate-scene: fallback send failed', fallbackErr)
          send('error', { message: 'beat-gen failed and fallback unavailable' })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
