import { NextResponse } from 'next/server'
import { streamJsonText, MODELS, extractJsonObject } from '@/lib/anthropic'
import {
  coerceRawSceneJson,
  sceneSchema,
  sanitizeScene,
  type ParsedScene,
} from '@/lib/schemas/scene'
import { episodePlanSchema } from '@/lib/schemas/episode'
import {
  buildScenePromptParts,
  type PriorChoiceSummary,
} from '@/lib/prompts/scene'
import type { Episode, Role, Scene } from '@/lib/types'
import { getToneSpec } from '@/lib/cameos/tone'
import type { ToneId, ToneSpec } from '@/lib/cameos/types'

// Mirrors client-side constants in src/lib/session.ts.
const AUTHORED_SCENE_COUNT = 8

type Body = {
  episode?: unknown
  episodeIndex?: unknown
  sceneIndexInEpisode?: unknown
  /** Round within the scene (0..roundCount-1). Each round = one
   *  dialogue exchange + one choice block. */
  roundIndex?: unknown
  /** Optional override of the plan's roundCount; defaults to plan value. */
  roundCount?: unknown
  /** The choice made in the prior round of THIS scene (if any). The
   *  load-bearing input for within-scene branching. */
  priorRoundChoice?: unknown
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

function asPriorRoundChoice(v: unknown): PriorChoiceSummary | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return {
    sceneId: asInt(o.sceneId, 0),
    choiceLabel: asString(o.choiceLabel, '(unspecified)'),
    hypeDelta: asInt(o.hypeDelta, 0),
    integrityDelta: asInt(o.integrityDelta, 0),
  }
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

function parseFromRaw(
  raw: string,
  primaryRole: Role,
  allowedRoles: ReadonlyArray<Role>,
): ParsedScene {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[generate-scene] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = sceneSchema.safeParse(coerceRawSceneJson(json, { primaryRole, allowedRoles }))
  if (!result.success) {
    console.warn(
      '[generate-scene] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[generate-scene] payload was:', JSON.stringify(json).slice(0, 800))
    throw result.error
  }
  return sanitizeScene(result.data, { allowedRoles })
}

// ── Incremental JSON extractors for streaming scene generation ──────
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

function readStringFieldValue(text: string, key: string, endPos: number): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`)
  const m = re.exec(text)
  if (!m || m.index === undefined) return null
  const valueStart = m.index + m[0].length
  const raw = text.slice(valueStart, endPos - 1)
  return raw
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
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
      { error: 'invalid episode plan', detail: String(err) },
      { status: 400 },
    )
  }

  const sceneIndexInEpisode = asInt(body.sceneIndexInEpisode, 0)
  const plan = episode.scenes[sceneIndexInEpisode]
  if (!plan) {
    return NextResponse.json(
      {
        error: `no scene plan at index ${sceneIndexInEpisode} (episode has ${episode.scenes.length} scenes)`,
      },
      { status: 400 },
    )
  }

  const roundCount = Math.min(
    4,
    Math.max(2, asInt(body.roundCount, plan.roundCount ?? 3)),
  )
  const roundIndex = Math.min(
    roundCount - 1,
    Math.max(0, asInt(body.roundIndex, 0)),
  )
  const isFinalRound = roundIndex === roundCount - 1
  const priorRoundChoice = asPriorRoundChoice(body.priorRoundChoice)

  // Global llmIndex is owned by the client (one rendered Scene per
  // round). We compose a stable sceneId from (episodeIndex,
  // sceneIndexInEpisode, roundIndex) but the canonical store key is
  // still `arc.scenes[globalLLMIndex]`. Each round = one Scene record.
  const globalLLMIndex =
    asInt(body.episodeIndex, episode.episodeIndex) * 20 +
    sceneIndexInEpisode * 4 +
    roundIndex
  const sceneId = AUTHORED_SCENE_COUNT + globalLLMIndex + 1

  const allowedRoles: Role[] = Array.from(
    new Set<Role>(plan.cast.map((c) => c.role as Role).concat(plan.role)),
  )

  const promptInput = {
    episode,
    sceneIndexInEpisode,
    roundIndex,
    roundCount,
    priorRoundChoice,
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
  }

  const { systemBlocks, userBlocks } = buildScenePromptParts(promptInput)

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(name, data)))
      }

      // Emit the pre-fixed imagePrompt immediately so image-gen can
      // start before Haiku finishes streaming. The plan committed to
      // it; Haiku may sharpen it in the final scene, but the client
      // can use the plan's version for the image (already 1 image
      // per scene budget; sharpening doesn't justify regenerating).
      send('imagePrompt', { imagePrompt: plan.imagePrompt })

      const sendFallback = () => {
        // Build a minimal placeholder scene from the plan + its first
        // cast member. No fallback JSON file anymore — the plan IS
        // the fallback.
        const speaker = plan.role
        const fallbackScene: Scene = {
          id: sceneId,
          title: `Episode ${episode.episodeIndex} · Scene ${sceneIndexInEpisode + 1}`,
          role: plan.role,
          archetype: plan.role,
          cast: plan.cast,
          imagePrompt: plan.imagePrompt,
          dialogue: [
            {
              speaker: 'narrator',
              text: plan.setting,
            },
            {
              speaker,
              text: plan.beat,
            },
          ],
          choices: [
            { id: 'a', label: 'Lean in.', hype: 1, integrity: -1 },
            { id: 'b', label: 'Hold the line.', hype: 0, integrity: 1 },
          ],
          timeoutSeconds: 15,
          timeoutChoiceId: 'b',
        }
        send('done', {
          scene: fallbackScene,
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
        // We already emitted imagePrompt up front; if Haiku sharpens
        // it in its emitted JSON, we silently ignore — the client has
        // already started image-gen on the plan's version.
        let sharpenedImagePromptFired = false

        const tryEmitProgress = (full: string) => {
          if (!sharpenedImagePromptFired) {
            const ipEnd = findStringFieldEnd(full, 'imagePrompt')
            if (ipEnd !== -1) {
              const ip = readStringFieldValue(full, 'imagePrompt', ipEnd)
              if (ip !== null && ip.length > 0) {
                sharpenedImagePromptFired = true
                // No second imagePrompt event — image-gen is one-shot.
              }
            }
          }
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
          maxTokens: 1000,
          temperature: 0.7,
          onText: (_delta, full) => tryEmitProgress(full),
          signal: request.signal,
        })

        const parsed = parseFromRaw(raw, plan.role, allowedRoles)
        // Mid-round deltas are server-clamped to ±1 — final round
        // gets the full ±2 range. The prompt asks for it, but Haiku
        // sometimes ignores; this is the structural guarantee that
        // stats accumulate at the same rate as the old architecture.
        const choices = parsed.choices.map((c) => ({
          ...c,
          hype: isFinalRound
            ? c.hype
            : Math.max(-1, Math.min(1, c.hype)),
          integrity: isFinalRound
            ? c.integrity
            : Math.max(-1, Math.min(1, c.integrity)),
        }))
        const scene: Scene = {
          ...parsed,
          choices,
          id: sceneId,
          archetype: parsed.role,
          cast: plan.cast,
          imagePrompt: plan.imagePrompt,
        }
        send('done', {
          scene,
          source: 'llm' as const,
          creditsRemaining: null,
        })
      } catch (err) {
        console.warn(
          `generate-scene episode=${episode.episodeIndex} scene=${sceneIndexInEpisode}: LLM path failed, returning fallback`,
          err,
        )
        try {
          sendFallback()
        } catch (fallbackErr) {
          console.error('generate-scene: fallback send failed', fallbackErr)
          send('error', { message: 'scene-gen failed and fallback unavailable' })
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
