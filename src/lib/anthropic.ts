import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

export const MODELS = {
  arc: 'claude-sonnet-4-6',
  scene: 'claude-haiku-4-5-20251001',
  epilogue: 'claude-haiku-4-5-20251001',
} as const

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
  cache?: boolean // if true, mark this block with cache_control: ephemeral
}

export interface CompleteJsonOptions {
  model: string
  systemBlocks: CachedBlock[] // turn into Anthropic system parameter (text blocks)
  userBlocks: CachedBlock[] // turn into a single user message with text blocks
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
        { role: 'assistant', content: '{' },
      ],
    })
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      throw new Error('No text block in Anthropic response')
    }
    const raw = '{' + block.text
    return parse(raw)
  }

  try {
    return await attempt()
  } catch (err) {
    console.warn('completeJson first attempt failed, retrying once', err)
    return attempt()
  }
}

export function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON object in response')
  return JSON.parse(raw.slice(start, end + 1))
}
