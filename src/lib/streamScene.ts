import type { Scene, DialogueLine } from './types'
export { PaywallRequiredError } from './paywall'
import { PaywallRequiredError } from './paywall'

// Streams /api/generate-scene's SSE response. Surfaces incremental
// progress events so the UI can render partial scenes (image prompt,
// dialogue lines) as they arrive — perceived latency drops from ~5-7s
// (waiting for the full Haiku response) to ~1-1.5s (first dialogue
// line). The full Scene object still arrives via the `done` event;
// callers that don't care about partial state can ignore the events.

export interface StreamSceneOptions {
  signal?: AbortSignal
  /** Fired once when imagePrompt completes — usually the first event. */
  onImagePrompt?: (imagePrompt: string) => void
  /** Fired once per completed dialogue entry as it streams in. */
  onDialogueLine?: (line: DialogueLine, index: number) => void
}

export interface StreamSceneResult {
  scene: Scene
  source: 'llm' | 'fallback'
  creditsRemaining?: number | null
}

export async function streamScene(
  body: unknown,
  opts: StreamSceneOptions = {},
): Promise<StreamSceneResult> {
  const res = await fetch('/api/generate-scene', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  // The credit-debit path returns a 402 JSON response BEFORE the stream
  // starts, so we still need to handle non-streaming paywall responses.
  if (res.status === 402) {
    const data = (await res.json().catch(() => ({}))) as {
      creditsRemaining?: number
    }
    throw new PaywallRequiredError(data.creditsRemaining ?? 0)
  }
  if (!res.ok || !res.body) {
    throw new Error(`generate-scene HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: StreamSceneResult | null = null
  let streamError: string | null = null

  // Each SSE message is `event: <name>\ndata: <json>\n\n`. Same parser
  // pattern as streamArc — accumulate bytes, split on the blank-line
  // terminator, dispatch each block.
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
    if (event === 'imagePrompt') {
      const ip = (payload as { imagePrompt?: string })?.imagePrompt
      if (typeof ip === 'string' && ip.length > 0) opts.onImagePrompt?.(ip)
    } else if (event === 'dialogueLine') {
      const p = payload as { index?: number; speaker?: string; text?: string }
      if (typeof p.text !== 'string' || p.text.length === 0) return
      const speaker =
        (typeof p.speaker === 'string'
          ? p.speaker
          : 'narrator') as DialogueLine['speaker']
      const idx = typeof p.index === 'number' ? p.index : 0
      opts.onDialogueLine?.({ speaker, text: p.text }, idx)
    } else if (event === 'done') {
      const p = payload as {
        scene?: Scene
        source?: 'llm' | 'fallback'
        creditsRemaining?: number | null
      }
      if (p.scene) {
        result = {
          scene: p.scene,
          source: p.source ?? 'llm',
          creditsRemaining: p.creditsRemaining ?? null,
        }
      }
    } else if (event === 'error') {
      const msg = (payload as { message?: string })?.message ?? 'scene-gen stream error'
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
  if (buffer.length > 0) handleBlock(buffer)

  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('generate-scene stream ended without `done`')
  return result
}
