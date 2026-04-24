import { NextResponse } from 'next/server'

/**
 * Dev-only route — never ships meaningful data in production.
 *
 * Returns { skip: true } when both API keys are present in the server
 * environment so the client can bypass the ApiKeysPanel during development.
 * In production this always returns { skip: false }.
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ skip: false })
  }

  const hasOpenai = Boolean(process.env.OPENAI_API_KEY?.trim())
  const hasElevenlabs = Boolean(process.env.ELEVENLABS_API_KEY?.trim())

  return NextResponse.json({
    skip: hasOpenai && hasElevenlabs,
  })
}
