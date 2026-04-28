import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

export const MODELS = {
  arc: 'claude-sonnet-4-6',
  scene: 'claude-haiku-4-5-20251001',
  epilogue: 'claude-haiku-4-5-20251001',
} as const

/** Arc skeleton generation; override with ANTHROPIC_ARC_MODEL for faster (e.g. Haiku) runs. */
export function arcModel(): string {
  const o = process.env.ANTHROPIC_ARC_MODEL?.trim()
  return o && o.length > 0 ? o : MODELS.arc
}

let cached: Anthropic | null = null

function client(): Anthropic {
  if (cached) return cached
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY')
  cached = new Anthropic({ apiKey })
  return cached
}

export interface CachedBlock {
  text: string
  cache?: boolean
}

export interface CompleteJsonOptions {
  model: string
  systemBlocks: CachedBlock[]
  userBlocks: CachedBlock[]
  maxTokens?: number
  temperature?: number
}

function toContentBlocks(blocks: CachedBlock[]): Anthropic.TextBlockParam[] {
  return blocks.map((b) => {
    const block: Anthropic.TextBlockParam = { type: 'text', text: b.text }
    if (b.cache) {
      block.cache_control = { type: 'ephemeral' }
    }
    return block
  })
}

export async function completeJson<T>(
  opts: CompleteJsonOptions,
  parse: (raw: string) => T,
): Promise<T> {
  const { model, systemBlocks, userBlocks, maxTokens = 2400, temperature = 0.85 } = opts

  const attempt = async (extraHint?: string): Promise<T> => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: toContentBlocks(userBlocks) },
    ]
    if (extraHint) {
      messages.push({ role: 'user', content: extraHint })
    }
    const response = await client().messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: toContentBlocks(systemBlocks),
      messages,
    })
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      throw new Error('No text block in Anthropic response')
    }
    return parse(block.text)
  }

  try {
    return await attempt()
  } catch (err) {
    console.warn('completeJson first attempt failed, retrying once', err)
    // Tell the model exactly what failed. Haiku tends to make the same
    // mistake on a blind retry; a targeted hint cuts the failure rate.
    // The most common parse failure is unescaped double quotes inside
    // dialogue "text" values — we surface that explicitly.
    const isParseErr =
      err instanceof SyntaxError ||
      (err instanceof Error && /JSON|parse/i.test(err.message))
    const hint = isParseErr
      ? `Your previous response failed JSON parsing with: ${err instanceof Error ? err.message : String(err)}. The most common cause is an unescaped double-quote (") inside a string value. Re-emit the JSON object. Inside any "text" field, use ONLY single quotes (') for in-text speech. Never use " inside a string value. Re-output the SAME scene content with that fixed.`
      : undefined
    return attempt(hint)
  }
}

export interface StreamJsonTextOptions extends CompleteJsonOptions {
  // Called for each text delta, with the cumulative text so far. Used by
  // generate-arc to incrementally parse out scene outlines as they finish.
  onText?: (delta: string, full: string) => void
  signal?: AbortSignal
}

// Streams an Anthropic message and returns the full assembled text. Errors
// in the stream propagate; the caller is responsible for fallback logic.
export async function streamJsonText(opts: StreamJsonTextOptions): Promise<string> {
  const { model, systemBlocks, userBlocks, maxTokens = 2400, temperature = 0.85, onText, signal } = opts

  const stream = client().messages.stream(
    {
      model,
      max_tokens: maxTokens,
      temperature,
      system: toContentBlocks(systemBlocks),
      messages: [
        { role: 'user', content: toContentBlocks(userBlocks) },
      ],
    },
    signal ? { signal } : undefined,
  )

  let full = ''
  stream.on('text', (delta: string) => {
    full += delta
    onText?.(delta, full)
  })

  await stream.finalMessage()
  return full
}

// Tolerant JSON extraction:
// - Strips an optional ```json or ``` fence
// - Tolerates JS-style leading + on positive numbers ("integrity": +1) which
//   Haiku 4.5 emits sometimes. Strict JSON forbids this; we patch before parse.
// - Tolerates trailing commas (also produced occasionally).
export function extractJsonObject(raw: string): unknown {
  let s = raw.trim()
  // Strip code fences if present
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  }
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON object in response')
  let json = s.slice(start, end + 1)
  // +1 / +2 → 1 / 2 only when preceded by `:` (i.e., a number value)
  json = json.replace(/:(\s*)\+(\d)/g, ':$1$2')
  // Trailing commas before } or ]
  json = json.replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(json)
  } catch (err) {
    // Defense-in-depth: dialogue "text" fields sometimes contain
    // unescaped " (Haiku narrating a character's quoted speech). The
    // prompt forbids it, but when the rule is broken we try to repair
    // before failing. Walks string boundaries; when a "text" string
    // would close before a , or }, escapes the offending interior ".
    // Rethrows the original error if repair didn't change anything.
    const repaired = repairUnescapedQuotesInStringFields(json)
    if (repaired !== json) {
      try {
        return JSON.parse(repaired)
      } catch {
        // fallthrough — original error is more informative
      }
    }
    throw err
  }
}

// Scans the JSON looking for `"key": "..."` patterns. When it finds a
// string value whose closing " isn't followed by , } or ] (i.e. the
// LLM emitted an unescaped " inside the value), it escapes the
// problematic interior quotes and continues. Best-effort recovery —
// only meaningful when the prompt rule "no internal double quotes"
// has been violated.
function repairUnescapedQuotesInStringFields(json: string): string {
  const out: string[] = []
  let i = 0
  let inString = false
  let escape = false
  let stringStart = -1
  while (i < json.length) {
    const c = json[i]!
    if (!inString) {
      out.push(c)
      if (c === '"') {
        inString = true
        stringStart = out.length - 1
      }
      i++
      continue
    }
    // inside a string
    if (escape) {
      out.push(c)
      escape = false
      i++
      continue
    }
    if (c === '\\') {
      out.push(c)
      escape = true
      i++
      continue
    }
    if (c === '"') {
      // Peek ahead: is this a real terminator (followed by ws then , } : ])
      // or a stray internal quote?
      let j = i + 1
      while (j < json.length && /\s/.test(json[j]!)) j++
      const next = json[j]
      if (
        next === undefined ||
        next === ',' ||
        next === '}' ||
        next === ']' ||
        next === ':'
      ) {
        // Real terminator. Close the string.
        out.push(c)
        inString = false
        i++
      } else {
        // Stray quote inside a string — escape it.
        out.push('\\')
        out.push(c)
        i++
      }
      continue
    }
    out.push(c)
    i++
  }
  return out.join('')
}
