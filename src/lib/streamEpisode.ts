import type { Episode } from './types'
export { PaywallRequiredError } from './paywall'
import { PaywallRequiredError } from './paywall'

export interface FetchEpisodeResult {
  episode: Episode
  source: 'llm' | 'fallback'
  creditsRemaining?: number | null
}

/**
 * POSTs to /api/generate-episode and parses the SSE response. The
 * episode endpoint is non-streaming in spirit — it returns one
 * `done` event with the full plan — but the wire format is SSE for
 * parity with the rest of the LLM stack (and so progress events can
 * be added later without changing callers).
 */
export async function fetchEpisode(
  body: unknown,
  opts: { signal?: AbortSignal } = {},
): Promise<FetchEpisodeResult> {
  const res = await fetch('/api/generate-episode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (res.status === 402) {
    const data = (await res.json().catch(() => ({}))) as {
      creditsRemaining?: number
    }
    throw new PaywallRequiredError(data.creditsRemaining ?? 0)
  }
  if (!res.ok || !res.body) {
    throw new Error(`generate-episode HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: FetchEpisodeResult | null = null
  let streamError: string | null = null

  const handleBlock = (block: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length === 0) return
    let payload: unknown
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }
    if (event === 'done') {
      const p = payload as {
        episode?: Episode
        source?: 'llm' | 'fallback'
        creditsRemaining?: number | null
      }
      if (p.episode) {
        result = {
          episode: p.episode,
          source: p.source ?? 'llm',
          creditsRemaining: p.creditsRemaining ?? null,
        }
      }
    } else if (event === 'error') {
      streamError =
        (payload as { message?: string })?.message ?? 'episode-gen stream error'
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    if (done) break
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      if (block.length > 0) handleBlock(block)
    }
  }
  if (buffer.length > 0) handleBlock(buffer)

  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('generate-episode stream ended without `done`')
  return result
}
