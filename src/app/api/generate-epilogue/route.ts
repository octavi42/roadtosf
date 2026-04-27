import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'

type Body = {
  startupName?: unknown
  endingKey?: unknown
  flavorTags?: unknown
  team?: unknown
  fundingModel?: unknown
  concern?: unknown
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
  sceneId: number
  choiceLabel: string
}

function asChoiceHistory(v: unknown): ChoiceRecord[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item): ChoiceRecord[] => {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    const sceneId = typeof o.sceneId === 'number' ? Math.trunc(o.sceneId) : 0
    const choiceLabel = asString(o.choiceLabel, '(unspecified)')
    return [{ sceneId, choiceLabel }]
  })
}

const SYSTEM = `You are writing the closing epilogue for "Road to SF", a satirical comic-book founder game.

HARD RULES:
- Output a single JSON object only. No prose before or after, no fences. Shape: {"epilogue": "..."}
- One paragraph, ~80 words, max 600 chars.
- Tone: present-tense, biting, Bloomberg lede with a comic punchline at the end.
- HONOR PLAYER FACTS: if Team says "solo", do NOT invent a cofounder character (no Maya, no Anna, no anyone). If Team names a person, use that name verbatim. If Funding says "bootstrapping", do NOT mention VCs or term sheets that didn't happen.
- Do NOT name real people; archetype them.`

function parseFromRaw(raw: string) {
  return epilogueSchema.parse(extractJsonObject(raw))
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
  const team = asString(body.team, '')
  const fundingModel = asString(body.fundingModel, '')
  const concern = asString(body.concern, '')
  const history = asChoiceHistory(body.choiceHistory)

  const formatted = history.length
    ? history.map((h) => `Scene ${h.sceneId}: "${h.choiceLabel}"`).join('\n')
    : '(no recorded choices)'

  const user = `Startup: ${startupName}
Ending: ${endingKey}
Flavor tags: ${flavorTags.join(', ') || '(none)'}

PLAYER FACTS (HONOR THESE):
Team: ${team || '(unstated; treat as solo, do NOT invent a cofounder)'}
Funding: ${fundingModel || '(unstated; do NOT assume a fundraising track)'}
Current concern: ${concern || '(unstated)'}

Choices made (in order):
${formatted}

Write the epilogue now.`

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')
    const result = await completeJson(
      {
        model: MODELS.epilogue,
        systemBlocks: [{ text: SYSTEM, cache: false }],
        userBlocks: [{ text: user, cache: false }],
        maxTokens: 400,
        temperature: 0.9,
      },
      parseFromRaw,
    )
    return NextResponse.json({ epilogue: result.epilogue, source: 'llm' as const })
  } catch (err) {
    console.warn('generate-epilogue: LLM path failed, returning fallback', err)
    const fallback = `${startupName} ended at ${endingKey.toUpperCase()}. The founder logged off, opened the same Tartine table the next morning, and quietly started a new doc titled "v2". The Caltrain back to the city was on time.`
    return NextResponse.json({ epilogue: fallback, source: 'fallback' as const })
  }
}
