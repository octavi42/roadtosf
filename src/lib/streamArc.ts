import type { ArcSkeleton, SceneOutline } from './types'

export interface StreamArcOptions {
  signal?: AbortSignal
  onScene?: (outline: SceneOutline) => void
}

export interface StreamArcResult {
  skeleton: ArcSkeleton
  source: 'llm' | 'fallback'
}

/**
 * POSTs to /api/generate-arc and consumes the SSE stream. Emits `onScene`
 * for each outline as it lands and resolves with the final skeleton on the
 * `done` event. Rejects on network failure or stream-level error events.
 *
 * EventSource doesn't do POST, so we use fetch + manual SSE framing.
 */
export async function streamArc(
  body: unknown,
  opts: StreamArcOptions = {},
): Promise<StreamArcResult> {
  const res = await fetch('/api/generate-arc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok || !res.body) {
    throw new Error(`generate-arc HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: StreamArcResult | null = null
  let streamError: string | null = null

  // Each SSE message is "event: <name>\ndata: <json>\n\n". We accumulate
  // bytes, split on the blank-line terminator, and dispatch each block.
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
    if (event === 'scene') {
      const outline = (payload as { outline?: SceneOutline })?.outline
      if (outline) opts.onScene?.(outline)
    } else if (event === 'done') {
      const p = payload as { skeleton?: ArcSkeleton; source?: 'llm' | 'fallback' }
      if (p.skeleton) result = { skeleton: p.skeleton, source: p.source ?? 'llm' }
    } else if (event === 'error') {
      const msg = (payload as { message?: string })?.message ?? 'arc-gen stream error'
      streamError = msg
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
  // Flush any tail block (shouldn't happen if server emits trailing \n\n).
  if (buffer.length > 0) handleBlock(buffer)

  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('generate-arc stream ended without `done`')
  return result
}
