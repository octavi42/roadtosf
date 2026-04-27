import { NextResponse } from 'next/server'
import { hasPaidPlaythroughForEmail } from '@/lib/playthroughs'
import { getBalance } from '@/lib/credits'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = { email?: unknown }

/**
 * Frequent-flyer probe used by the paywall UI to decide whether to offer
 * an OTP login. Returns:
 *   - `paid`: has the email ever paid? (drives "★ Frequent flyer found" copy)
 *   - `credits`: how many credits remain on the email's balance row
 *
 * The paywall combines both: only `credits > 0` should let an OTP login
 * exit the paywall — otherwise the returning user has spent everything
 * and needs to top up. Returning {paid:true, credits:0} is the "log in to
 * see your empty wallet, then buy more" branch.
 */
export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ paid: false, credits: 0 })
  }

  try {
    const [paid, credits] = await Promise.all([
      hasPaidPlaythroughForEmail(email),
      getBalance({ anonId: null, email }),
    ])
    return NextResponse.json({ paid, credits })
  } catch (err) {
    console.error('paywall/check-email failed', err)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }
}
