import { NextResponse } from 'next/server'
import { completeJson, MODELS, extractJsonObject } from '@/lib/anthropic'
import { extractResultSchema, type ParsedExtractResult } from '@/lib/schemas/extract'
import { buildExtractPromptParts } from '@/lib/prompts/extract'

type Body = {
  startupDescription?: unknown
  founderPersona?: unknown
}

const EXTRACT_TIMEOUT_MS = 8000

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function parseFromRaw(raw: string): ParsedExtractResult {
  let json: unknown
  try {
    json = extractJsonObject(raw)
  } catch (e) {
    console.warn('[extract-facts] JSON extraction failed. raw:', raw.slice(0, 800))
    throw e
  }
  const result = extractResultSchema.safeParse(json)
  if (!result.success) {
    console.warn(
      '[extract-facts] Zod validation failed. issues:',
      JSON.stringify(result.error.issues, null, 2),
    )
    console.warn('[extract-facts] payload was:', JSON.stringify(json).slice(0, 800))
    throw result.error
  }
  return result.data
}

function emptyResult() {
  return { extracted: {}, missing: [] as ParsedExtractResult['missing'] }
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const startupDescription = asString(body.startupDescription, '').trim()
  const founderPersona = asString(body.founderPersona, '').trim()

  if (!startupDescription) {
    return NextResponse.json({ ...emptyResult(), source: 'fallback' as const })
  }

  const { systemBlocks, userBlocks } = buildExtractPromptParts({
    startupDescription,
    founderPersona,
  })

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing')
    const result = await Promise.race<ParsedExtractResult>([
      completeJson(
        {
          model: MODELS.scene,
          systemBlocks,
          userBlocks,
          maxTokens: 600,
          temperature: 0.6,
        },
        parseFromRaw,
      ),
      new Promise<ParsedExtractResult>((_, reject) =>
        setTimeout(() => reject(new Error('extract-facts timed out')), EXTRACT_TIMEOUT_MS),
      ),
    ])
    return NextResponse.json({ ...result, source: 'llm' as const })
  } catch (err) {
    console.warn('extract-facts: LLM path failed, returning empty', err)
    return NextResponse.json({ ...emptyResult(), source: 'fallback' as const })
  }
}
