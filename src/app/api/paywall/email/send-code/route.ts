import { NextResponse } from 'next/server'
import { hasPaidPlaythroughForEmail } from '@/lib/playthroughs'
import { issueEmailCode } from '@/lib/email-codes'
import { sendOtpEmail } from '@/lib/email'

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
    return NextResponse.json({ error: 'invalid email' }, { status: 400 })
  }

  try {
    // Only issue codes for emails that already have a paid playthrough.
    // /check-email already exposed existence to the client, so there's no
    // additional info leak here.
    const paid = await hasPaidPlaythroughForEmail(email)
    if (!paid) {
      return NextResponse.json(
        { error: 'no payment found for this email' },
        { status: 404 },
      )
    }

    const result = await issueEmailCode(email)
    if (result.kind === 'rate_limited') {
      return NextResponse.json(
        { error: 'too many requests — wait a minute' },
        { status: 429 },
      )
    }

    // Dev-only: same bypass as /api/auth/send-code — log the code so the
    // OTP loop can be exercised with arbitrary emails (Resend's sandbox
    // only delivers to the account owner). Production never hits this.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] paywall OTP for ${email}: ${result.code}`)
      try {
        await sendOtpEmail(email, result.code)
      } catch (err) {
        console.warn(
          `[dev] paywall sendOtpEmail failed (continuing — read code from log):`,
          err instanceof Error ? err.message : err,
        )
      }
      return NextResponse.json({ sent: true, devCode: result.code })
    }

    await sendOtpEmail(email, result.code)
    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('paywall/email/send-code failed', err)
    const message =
      err instanceof Error && err.message.startsWith('resend:')
        ? err.message
        : 'send failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
