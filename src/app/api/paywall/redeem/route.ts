import { NextResponse } from 'next/server'
import { redeemPlaythroughByEmail } from '@/lib/playthroughs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = { playthroughId?: unknown; email?: unknown }

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const playthroughId =
    typeof body.playthroughId === 'string' ? body.playthroughId : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!UUID_RE.test(playthroughId)) {
    return NextResponse.json({ error: 'invalid playthroughId' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 })
  }

  try {
    // Trust gate: server confirms a prior paid playthrough exists for this
    // email before flipping the current row. The client never asserts paid
    // status — it only requests redemption.
    const updated = await redeemPlaythroughByEmail({ playthroughId, email })
    if (!updated) {
      return NextResponse.json({ paid: false })
    }
    return NextResponse.json({ paid: true })
  } catch (err) {
    console.error('paywall/redeem failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}
