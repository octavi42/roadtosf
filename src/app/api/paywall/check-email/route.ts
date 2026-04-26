import { NextResponse } from 'next/server'
import { hasPaidPlaythroughForEmail } from '@/lib/playthroughs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = { email?: unknown }

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ paid: false })
  }

  try {
    const paid = await hasPaidPlaythroughForEmail(email)
    return NextResponse.json({ paid })
  } catch (err) {
    console.error('paywall/check-email failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}
