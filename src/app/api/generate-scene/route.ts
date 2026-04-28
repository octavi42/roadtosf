import { NextResponse } from 'next/server'
import { streamJsonText, MODELS, extractJsonObject } from '@/lib/anthropic'
import {
  coerceRawSceneJson,
  sceneSchema,
  sanitizeScene,
  type ParsedScene,
} from '@/lib/schemas/scene'
import { arcSkeletonSchema } from '@/lib/schemas/arc'
import { buildScenePromptParts, type PriorChoiceSummary } from '@/lib/prompts/scene'
import type { Archetype } from '@/lib/types'
import { getToneSpec } from '@/lib/cameos/tone'
import type { ToneId, ToneSpec } from '@/lib/cameos/types'
import fallbackScenes from '@/lib/fallback/scenes.json'
import { readAnonId } from '@/lib/anon-id'
import { readSessionEmail } from '@/lib/auth'
import {
  debitCredit,
  getBalance,
  InsufficientCreditsError,
  REASONS,
} from '@/lib/credits'

// Mirrors client-side constants in src/lib/session.ts.
const AUTHORED_SCENE_COUNT = 8
const SCENES_PER_GROUP = 4
const GROUPS_PER_EPISODE = 5
const EPISODE_LENGTH = SCENES_PER_GROUP * GROUPS_PER_EPISODE // 20

type Body = {
  llmIndex?: unknown // global LLM-tail index (0..N)
  llmIndexInEpisode?: unknown // optional override; otherwise computed
  episodeIndex?: unknown
  arcSkeleton?: unknown
  storySoFar?: unknown
  startupName?: unknown
  startupDescription?: unknown
  founderPersona?: unknown
  stage?: unknown
  team?: unknown
  fundingModel?: unknown
  targetCustomer?: unknown
  concern?: unknown
  flavorTags?: unknown
  recentChoices?: unknown
  priorChoices?: unknown // back-compat alias
  currentStats?: unknown
  // Optional: routed through to the credit_ledger row created on debit so
  // we can answer "which playthrough burned this credit?" later.
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

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
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

function parseFromRaw(raw: string, assignedArchetype: Archetype): ParsedScene {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[generate-scene] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = sceneSchema.safeParse(coerceRawSceneJson(json, { assignedArchetype }))
  if (!result.success) {
    console.warn(
      '[generate-scene] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[generate-scene] payload was:', JSON.stringify(json).slice(0, 800))
    throw result.error
  }
  return sanitizeScene(result.data)
}

// ── Incremental JSON extractors for streaming scene generation ───────
//
// As Haiku streams the JSON top-to-bottom, these helpers detect when
// specific fields have been fully emitted so we can surface them to
// the client immediately. The keys we care about are emitted in this
// order: imagePrompt → dialogue[] (one object at a time) → choices[].
// Once a field fires, we never re-emit it for the same scene.

// Returns the position immediately AFTER `"<key>" : "..."`'s closing
// quote, OR -1 if the value is still streaming. Handles escaped chars.
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
    if (c === '"') return i + 1 // points just past the closing quote
    i++
  }
  return -1
}

// Extracts the string value of a field whose end we've already located.
// `endPos` is the position from findStringFieldEnd.
function readStringFieldValue(text: string, key: string, endPos: number): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`)
  const m = re.exec(text)
  if (!m || m.index === undefined) return null
  const valueStart = m.index + m[0].length
  // endPos points just past the closing quote, so value runs to endPos-1.
  const raw = text.slice(valueStart, endPos - 1)
  // Unescape JSON string escapes that matter for plain text. Conservative:
  // \" → ", \\ → \, \n → newline. Drop anything weirder.
  return raw
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
}

// Locates the start of `"dialogue": [` and returns the position just
// after the opening bracket. Returns -1 if not yet present.
function findDialogueArrayStart(text: string): number {
  const m = text.match(/"dialogue"\s*:\s*\[/)
  if (!m || m.index === undefined) return -1
  return m.index + m[0].length
}

// Walks from `start` through the dialogue array, returning the next
// complete `{...}` object (parsed) plus the index just past it. Used
// to extract `{ "speaker": "...", "text": "..." }` entries one at a
// time as Haiku streams them. Returns null while streaming or when
// the array closes.
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

  const llmIndex = asInt(body.llmIndex, 0)
  const computedEpisodeIndex = Math.floor(llmIndex / EPISODE_LENGTH)
  const computedInEpisode = llmIndex % EPISODE_LENGTH
  const episodeIndex = asInt(body.episodeIndex, computedEpisodeIndex)
  const llmIndexInEpisode = asInt(body.llmIndexInEpisode, computedInEpisode)
  // Within an episode, scenes are organized into archetype groups of
  // SCENES_PER_GROUP sub-scenes each. The arc skeleton has one outline per
  // group, indexed 0..GROUPS_PER_EPISODE-1.
  const groupIndex = Math.floor(llmIndexInEpisode / SCENES_PER_GROUP)
  const subSceneIndex = llmIndexInEpisode % SCENES_PER_GROUP

  let arcSkeleton
  try {
    arcSkeleton = arcSkeletonSchema.parse(body.arcSkeleton)
  } catch (err) {
    return NextResponse.json({ error: 'invalid arcSkeleton', detail: String(err) }, { status: 400 })
  }

  const outline =
    arcSkeleton.scenes.find((s) => s.index === groupIndex) ?? arcSkeleton.scenes[groupIndex]
  if (!outline) {
    return NextResponse.json({ error: `no outline for group ${groupIndex} (sub ${subSceneIndex}) in episode ${episodeIndex}` }, { status: 400 })
  }

  const sceneId = AUTHORED_SCENE_COUNT + llmIndex + 1

  // 1 credit per LLM-generated group of SCENES_PER_GROUP sub-scenes. We
  // debit on the leader (sub-scene 0); the other 3 sub-scenes ride free on
  // the same credit. Doing this before the LLM call means a busted balance
  // never spends Anthropic tokens. The 3 followers can still arrive at the
  // server in parallel before the leader's debit fires — we accept that
  // small ($0.30) leak because the client also pre-checks balance via
  // /api/credits/balance, which makes the leak a rare race rather than the
  // common path.
  const playthroughId =
    typeof body.playthroughId === 'string' ? body.playthroughId : null
  let creditsRemaining: number | null = null
  if (subSceneIndex === 0) {
    const [anonId, email] = await Promise.all([
      readAnonId(),
      readSessionEmail(),
    ])
    try {
      const debited = await debitCredit(
        { anonId, email },
        {
          reason: REASONS.GROUP_DEBIT,
          playthroughId,
          episodeIndex,
          groupIndex,
          llmIndex,
        },
      )
      creditsRemaining = debited.remaining
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json(
          {
            error: 'insufficient_credits',
            paywall: true,
            creditsRemaining: err.balance,
          },
          { status: 402 },
        )
      }
      console.error('generate-scene: debit failed', err)
      return NextResponse.json(
        { error: 'credit debit failed' },
        { status: 500 },
      )
    }
  } else {
    // For sub-scenes 1..3, surface the current balance so the client display
    // stays in sync without a separate /api/credits/balance round-trip.
    const [anonId, email] = await Promise.all([
      readAnonId(),
      readSessionEmail(),
    ])
    try {
      creditsRemaining = await getBalance({ anonId, email })
    } catch (err) {
      console.error('generate-scene: getBalance failed (non-fatal)', err)
    }
  }

  const promptInput = {
    episodeIndex,
    llmIndexInEpisode,
    groupIndex,
    subSceneIndex,
    sceneId,
    outline,
    arcSkeleton,
    storySoFar: asString(body.storySoFar, '') || undefined,
    startupName: asString(body.startupName, 'the startup'),
    startupDescription: asString(body.startupDescription, ''),
    founderPersona: asString(body.founderPersona, ''),
    stage: asString(body.stage, '') || undefined,
    team: asString(body.team, '') || undefined,
    fundingModel: asString(body.fundingModel, '') || undefined,
    targetCustomer: asString(body.targetCustomer, '') || undefined,
    concern: asString(body.concern, '') || undefined,
    flavorTags: asStringArray(body.flavorTags),
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

  // Streaming SSE response. Events emitted (in order, as Haiku streams):
  //   imagePrompt → fired once when the imagePrompt field completes
  //                 (so the client can start image-gen immediately)
  //   dialogueLine → fired once per dialogue entry as each completes
  //                  (so the client can start TTS for that line and
  //                   render the speaker + text without waiting for
  //                   the rest of the scene)
  //   done → fired once at the end with the full validated Scene
  //   error → fired if the LLM call fails fatally; client falls back
  //
  // Total perceived latency to first audio: ~1-1.5s (vs ~5-7s before).
  // The full scene completion still takes ~5-7s, but by then the
  // player is already listening to the first lines.
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(name, data)))
      }

      const sendFallback = () => {
        const fbList = fallbackScenes as unknown[]
        const fb = fbList[llmIndex % fbList.length]
        if (!fb) {
          send('error', { message: 'no fallback scene available' })
          return
        }
        try {
          const parsed = sanitizeScene(sceneSchema.parse(fb))
          send('done', {
            scene: { ...parsed, id: sceneId },
            source: 'fallback' as const,
            creditsRemaining,
          })
        } catch (e) {
          send('error', { message: `fallback parse failed: ${String(e)}` })
        }
      }

      try {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')

        // Incremental-emit bookkeeping. Each field's "fired" flag prevents
        // duplicate events as the buffer grows.
        let imagePromptFired = false
        let dialogueArrayStart = -1
        let nextDialogueSearchPos = 0
        let dialogueLinesFired = 0

        const tryEmitProgress = (full: string) => {
          // imagePrompt — fires once when its closing quote arrives.
          if (!imagePromptFired) {
            const ipEnd = findStringFieldEnd(full, 'imagePrompt')
            if (ipEnd !== -1) {
              const ip = readStringFieldValue(full, 'imagePrompt', ipEnd)
              if (ip !== null && ip.length > 0) {
                imagePromptFired = true
                send('imagePrompt', { imagePrompt: ip })
              }
            }
          }
          // dialogue[] — fires once per completed entry.
          if (dialogueArrayStart === -1) {
            dialogueArrayStart = findDialogueArrayStart(full)
            if (dialogueArrayStart !== -1) nextDialogueSearchPos = dialogueArrayStart
          }
          if (dialogueArrayStart !== -1) {
            // Emit at most a generous cap so a runaway response doesn't
            // pump unbounded events. Real scenes are 2-4 lines.
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

        // Temperature: sub 0 (storylet setup) keeps 0.9 for prose
        // creativity. Sub 1-3 (choice-driven) drops to 0.4 — strict
        // compliance with the prior-choice directive matters more than
        // creative variation. We tried 0.6 and the model still drifted.
        const sceneTemperature = subSceneIndex === 0 ? 0.9 : 0.4

        // Forced assistant prefix for sub 1-3: pre-fills the JSON so
        // the FIRST dialogue line starts with `"You ` — pushing the
        // model into past-tense action voice no matter what choice
        // it's reacting to. The prompt persuasion ("PAST TENSE. The
        // action has happened") didn't fully land at any temperature;
        // the prefix is mechanical enforcement. Skipped for sub 0
        // because that's the storylet setup and shouldn't be forced
        // into "You [verb]" framing.
        const assistantPrefix =
          subSceneIndex >= 1
            ? `{
  "id": ${sceneId},
  "dialogue": [
    {"speaker": "narrator", "text": "You `
            : undefined

        const raw = await streamJsonText({
          model: MODELS.scene,
          systemBlocks,
          userBlocks,
          maxTokens: 1000,
          temperature: sceneTemperature,
          assistantPrefix,
          onText: (_delta, full) => tryEmitProgress(full),
          signal: request.signal,
        })

        const scene = parseFromRaw(raw, outline.archetype)
        send('done', {
          scene,
          source: 'llm' as const,
          creditsRemaining,
        })
      } catch (err) {
        console.warn(
          `generate-scene index=${llmIndex}: LLM path failed, returning fallback`,
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
