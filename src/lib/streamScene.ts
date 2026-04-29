import type { Beat, DialogueLine } from './types'
export { PaywallRequiredError } from './paywall'
import { PaywallRequiredError } from './paywall'

// Streams /api/generate-scene's SSE response. Each call returns ONE
// BEAT (dialogue + choices + isLastBeatOfScene flag). The client
// accumulates beats inside a Scene container as the player makes
// choices.

export interface StreamSceneOptions {
  signal?: AbortSignal
  /** Fired once per completed dialogue entry as it streams in. */
  onDialogueLine?: (line: DialogueLine, index: number) => void
}

export interface StreamSceneResult {
  beat: Beat
  sceneId: number
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
    if (event === 'dialogueLine') {
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
        beat?: Beat
        sceneId?: number
        source?: 'llm' | 'fallback'
        creditsRemaining?: number | null
      }
      if (p.beat) {
        result = {
          beat: p.beat,
          sceneId: typeof p.sceneId === 'number' ? p.sceneId : 0,
          source: p.source ?? 'llm',
          creditsRemaining: p.creditsRemaining ?? null,
        }
      }
    } else if (event === 'error') {
      const msg = (payload as { message?: string })?.message ?? 'beat-gen stream error'
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
