import { NextResponse } from 'next/server'
import { checkAndConsumeEmailCode } from '@/lib/email-codes'
import { hasPaidPlaythroughForEmail } from '@/lib/playthroughs'
import { setSessionEmail } from '@/lib/auth'
import { readAnonId } from '@/lib/anon-id'
import { bindAnonToEmail } from '@/lib/credits'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_RE = /^\d{6}$/

type Body = {
  email?: unknown
  code?: unknown
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

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 })
  }
  if (!CODE_RE.test(code)) {
    return NextResponse.json({ error: 'invalid code' }, { status: 400 })
  }

  try {
    // Belt-and-suspenders: even after OTP success, refuse to issue a session
    // for an email that has no paid runs. Stops a stale unconsumed code
    // (issued before all the user's runs were deleted, etc.) from minting a
    // session attached to nothing.
    const paid = await hasPaidPlaythroughForEmail(email)
    if (!paid) {
      return NextResponse.json(
        { error: 'no past playthroughs found for this email' },
        { status: 404 },
      )
    }

    const ok = await checkAndConsumeEmailCode(email, code)
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: 'invalid or expired code' },
        { status: 400 },
      )
    }

    await setSessionEmail(email)

    // Pull any anon-only credits (e.g. dev grants from this device) into
    // the email row so they're not orphaned by the new lookup contract
    // (anon-id-only queries skip rows that have an email). Best effort:
    // login should not fail if the merge step blows up.
    const anonId = await readAnonId()
    if (anonId) {
      try {
        await bindAnonToEmail(anonId, email)
      } catch (err) {
        console.error('auth/verify-code: bindAnonToEmail failed', err)
      }
    }

    return NextResponse.json({ ok: true, email: email.toLowerCase() })
  } catch (err) {
    console.error('auth/verify-code failed', err)
    return NextResponse.json({ error: 'verify failed' }, { status: 500 })
  }
}
