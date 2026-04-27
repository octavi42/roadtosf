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

  const attempt = async (): Promise<T> => {
    const response = await client().messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: toContentBlocks(systemBlocks),
      messages: [
        { role: 'user', content: toContentBlocks(userBlocks) },
      ],
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
    return attempt()
  }
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
  return JSON.parse(json)
}
