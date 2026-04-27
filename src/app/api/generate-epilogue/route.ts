import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeJson } from '@/lib/anthropic'

type Body = {
  startupName?: unknown
  endingKey?: unknown
  flavorTags?: unknown
  choiceHistory?: unknown
}

const epilogueSchema = z.object({
  epilogue: z.string().min(40).max(600),
})

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

interface ChoiceRecord {
  groupIndex: number
  sceneId: number
  choiceLabel: string
}

function asChoiceHistory(v: unknown): ChoiceRecord[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): ChoiceRecord[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    const groupIndex = typeof o.groupIndex === 'number' ? Math.trunc(o.groupIndex) : 1
    const sceneId = typeof o.sceneId === 'number' ? Math.trunc(o.sceneId) : 0
    const choiceLabel = asString(o.choiceLabel, '(unspecified)')
    return [{ groupIndex, sceneId, choiceLabel }]
  })
}

const SYSTEM = `You are writing the closing epilogue for "Road to SF", a satirical comic-book founder game. The player just finished. Produce one paragraph (~80 words, max 600 chars) that names specific choices the player made AND specific SF places/people referenced. Tone: present-tense, biting, like a Bloomberg lede, with a comic punchline at the end. Output a single JSON object: {"epilogue": "..."} — no prose, no fences. Do NOT name real people; use archetypes.`

function parseFromRaw(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON in response')
  return epilogueSchema.parse(JSON.parse(raw.slice(start, end + 1)))
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const startupName = asString(body.startupName, 'the startup')
  const endingKey = asString(body.endingKey, 'ghosted')
  const flavorTags = asStringArray(body.flavorTags)
  const history = asChoiceHistory(body.choiceHistory)

  const formattedHistory = history.length > 0
    ? history.map((h) => `Group ${h.groupIndex} Scene ${h.sceneId}: "${h.choiceLabel}"`).join('\n')
    : '(no recorded choices)'

  const user = `Startup: ${startupName}
Ending: ${endingKey}
Flavor tags: ${flavorTags.join(', ') || '(none)'}

Choices made (in order):
${formattedHistory}

Write the epilogue now.`

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')
    const result = await completeJson({ system: SYSTEM, user, maxTokens: 400, temperature: 0.9 }, parseFromRaw)
    return NextResponse.json({ epilogue: result.epilogue, source: 'llm' as const })
  } catch (err) {
    console.warn('generate-epilogue: LLM path failed, returning fallback', err)
    const fallback = `${startupName} ended at ${endingKey.toUpperCase()}. The founder logged off, opened the same Tartine table the next morning, and quietly started a new doc titled "v2". The Caltrain back to the city was on time.`
    return NextResponse.json({ epilogue: fallback, source: 'fallback' as const })
  }
}
