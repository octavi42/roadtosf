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
    // Same gate as the paywall send-code: only emails with at least one
    // completed paid run can request a login code. Prevents using this
    // endpoint as a generic email-validation oracle.
    const paid = await hasPaidPlaythroughForEmail(email)
    if (!paid) {
      return NextResponse.json(
        { error: 'no past playthroughs found for this email' },
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

    // Dev-only: log the code so you can finish the OTP loop without
    // depending on Resend (which only delivers to the account-owner email
    // unless you've verified a domain). Production never hits this branch.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] OTP for ${email}: ${result.code}`)
      try {
        await sendOtpEmail(email, result.code)
      } catch (err) {
        // Resend rejection (e.g. unverified-recipient sandbox error) is
        // non-fatal in dev — the code is in the server log already.
        console.warn(
          `[dev] sendOtpEmail failed (continuing — read code from log):`,
          err instanceof Error ? err.message : err,
        )
      }
      return NextResponse.json({ sent: true, devCode: result.code })
    }

    await sendOtpEmail(email, result.code)
    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('auth/send-code failed', err)
    const message =
      err instanceof Error && err.message.startsWith('resend:')
        ? err.message
        : 'send failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
