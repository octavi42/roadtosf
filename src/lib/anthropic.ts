import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

let cached: Anthropic | null = null

function client(): Anthropic {
  if (cached) return cached
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY')
  cached = new Anthropic({ apiKey })
  return cached
}

export interface CompleteJsonOptions {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}

export async function completeJson<T>(opts: CompleteJsonOptions, parse: (raw: string) => T): Promise<T> {
  const { system, user, maxTokens = 3000, temperature = 0.85 } = opts

  const attempt = async (): Promise<T> => {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [
        { role: 'user', content: user },
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
