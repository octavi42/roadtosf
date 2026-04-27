import { NextResponse } from 'next/server'
import { redeemPlaythroughByEmail } from '@/lib/playthroughs'
import { checkAndConsumeEmailCode } from '@/lib/email-codes'
import { setSessionEmail } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_RE = /^\d{6}$/

type Body = {
  email?: unknown
  code?: unknown
  playthroughId?: unknown
}

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const playthroughId =
    typeof body.playthroughId === 'string' ? body.playthroughId : ''

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 })
  }
  if (!CODE_RE.test(code)) {
    return NextResponse.json({ error: 'invalid code' }, { status: 400 })
  }
  if (!UUID_RE.test(playthroughId)) {
    return NextResponse.json(
      { error: 'invalid playthroughId' },
      { status: 400 },
    )
  }

  try {
    // Verify-and-redeem atomically server-side: the client cannot redeem
    // without a valid OTP, and the OTP cannot be reused (consumed on match).
    const ok = await checkAndConsumeEmailCode(email, code)
    if (!ok) {
      return NextResponse.json(
        { paid: false, error: 'invalid or expired code' },
        { status: 400 },
      )
    }

    const updated = await redeemPlaythroughByEmail({ playthroughId, email })
    if (!updated) {
      return NextResponse.json(
        { paid: false, error: 'no payment found' },
        { status: 404 },
      )
    }

    // Issue a login session — same email, OTP-verified, redemption succeeded.
    // Best-effort: cookie failure must not undo the redemption.
    try {
      await setSessionEmail(email)
    } catch (err) {
      console.error('paywall/email/verify-code: setSessionEmail failed', err)
    }

    return NextResponse.json({ paid: true })
  } catch (err) {
    console.error('paywall/email/verify-code failed', err)
    return NextResponse.json({ error: 'verify failed' }, { status: 500 })
  }
}
