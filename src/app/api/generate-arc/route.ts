import { streamJsonText, arcModel, extractJsonObject } from '@/lib/anthropic'
import {
  arcSkeletonSchema,
  sceneOutlineSchema,
  type ParsedArcSkeleton,
} from '@/lib/schemas/arc'
import { buildArcPromptParts, type PriorChoiceSummary } from '@/lib/prompts/arc'
import { selectFlavorPool } from '@/lib/silicon-mania/select'
import fallbackArc from '@/lib/fallback/arc.json'

type Body = {
  episodeIndex?: unknown
  priorStorySoFar?: unknown
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
  // Back-compat alias used by an earlier client; treated the same as recentChoices.
  priorChoices?: unknown
  currentStats?: unknown
  seed?: unknown
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseFromRaw(raw: string, episodeIndex: number): ParsedArcSkeleton {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[generate-arc] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = arcSkeletonSchema.safeParse(json)
  if (!result.success) {
    console.warn(
      '[generate-arc] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[generate-arc] payload was:', JSON.stringify(json).slice(0, 800))
    throw result.error
  }
  // Backfill episodeIndex from request if the model omitted it.
  return { ...result.data, episodeIndex: result.data.episodeIndex ?? episodeIndex }
}

// Locates `"scenes" : [` in the streamed text and returns the index *after*
// the opening bracket. Returns -1 if not yet present.
function findScenesArrayStart(text: string): number {
  const m = text.match(/"scenes"\s*:\s*\[/)
  if (!m || m.index === undefined) return -1
  return m.index + m[0].length
}

// Walks `s` from `start`, skipping commas/whitespace, and returns the next
// complete `{...}` object as parsed JSON plus the index just past it.
// Returns null if there is no complete object yet (still streaming) or if
// the array is closing (next non-ws char is `]`).
function nextCompleteObject(
  s: string,
  start: number,
): { value: unknown; end: number } | null {
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
    return new Response(JSON.stringify({ error: 'invalid json body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const episodeIndex = asInt(body.episodeIndex, 0)
  const priorStorySoFar = asString(body.priorStorySoFar, '') || undefined
  const recentChoices = asPriorChoices(body.recentChoices ?? body.priorChoices)
  const flavorTags = asStringArray(body.flavorTags)

  // Pull real-world SF news for this week. selectFlavorPool swallows DB
  // errors and returns [] — the arc-gen prompt then runs unmodified.
  const siliconManiaItems = await selectFlavorPool(flavorTags, 4)

  const promptInput = {
    episodeIndex,
    priorStorySoFar,
    startupName: asString(body.startupName, 'the startup'),
    startupDescription: asString(body.startupDescription, ''),
    founderPersona: asString(body.founderPersona, ''),
    stage: asString(body.stage, '') || undefined,
    team: asString(body.team, '') || undefined,
    fundingModel: asString(body.fundingModel, '') || undefined,
    targetCustomer: asString(body.targetCustomer, '') || undefined,
    concern: asString(body.concern, '') || undefined,
    flavorTags,
    recentChoices,
    currentStats: {
      hype: asInt((body.currentStats as Record<string, unknown> | undefined)?.hype, 0),
      integrity: asInt(
        (body.currentStats as Record<string, unknown> | undefined)?.integrity,
        0,
      ),
    },
    seed: asString(body.seed, '') || undefined,
    todayISO: todayISO(),
    siliconManiaItems,
  }

  const { systemBlocks, userBlocks } = buildArcPromptParts(promptInput)

  const encoder = new TextEncoder()
  const poolSize = siliconManiaItems.length

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(name, data)))
      }

      const sendFallback = () => {
        const parsed = arcSkeletonSchema.parse({ ...fallbackArc, episodeIndex })
        // Replay fallback scenes as `scene` events so the client treats this
        // path identically to a successful stream.
        for (const outline of parsed.scenes) {
          send('scene', { outline })
        }
        send('done', {
          skeleton: parsed,
          source: 'fallback' as const,
          siliconManiaPoolSize: poolSize,
        })
      }

      try {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')

        let scenesStart = -1
        let nextSearchPos = 0
        let emittedCount = 0

        const tryEmitScenes = (full: string) => {
          if (scenesStart === -1) {
            scenesStart = findScenesArrayStart(full)
            if (scenesStart === -1) return
            nextSearchPos = scenesStart
          }
          while (emittedCount < 5) {
            const result = nextCompleteObject(full, nextSearchPos)
            if (!result) break
            nextSearchPos = result.end
            emittedCount++
            const parsed = sceneOutlineSchema.safeParse(result.value)
            if (parsed.success) {
              send('scene', { outline: parsed.data })
            } else {
              // Don't fail the stream — the final whole-arc validation will
              // catch it and we'll fall back. Until then, keep streaming.
              console.warn(
                '[generate-arc] streaming outline failed schema; skipping mid-stream',
                parsed.error.issues,
              )
            }
          }
        }

        const raw = await streamJsonText({
          model: arcModel(),
          systemBlocks,
          userBlocks,
          maxTokens: 1500,
          temperature: 0.85,
          onText: (_delta, full) => tryEmitScenes(full),
          signal: request.signal,
        })

        const skeleton = parseFromRaw(raw, episodeIndex)
        send('done', {
          skeleton,
          source: 'llm' as const,
          siliconManiaPoolSize: poolSize,
        })
      } catch (err) {
        console.warn('generate-arc: stream path failed, sending fallback', err)
        try {
          sendFallback()
        } catch (fallbackErr) {
          console.error('generate-arc: fallback send failed', fallbackErr)
          send('error', { message: 'arc-gen failed and fallback unavailable' })
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
