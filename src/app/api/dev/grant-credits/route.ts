import { NextResponse } from 'next/server'
import { getOrCreateAnonId } from '@/lib/anon-id'
import { readSessionEmail } from '@/lib/auth'
import { grantCredits, REASONS } from '@/lib/credits'

/**
 * Dev-only counterpart to the Stripe verify path. Writes a real DB credit
 * row keyed by the caller's anon_id (and email if logged in), so the next
 * /api/generate-scene call has something to debit against. Without this,
 * the client-only devGrantCredits action would set paid=true and bump the
 * mirror, but the server would 402 the very first group fire and bounce
 * the user straight back to the paywall.
 *
 * 403 in production. The DevPanel that calls it is hidden in production
 * too, so this is belt-and-suspenders.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { amount?: unknown } = {}
  try {
    body = (await request.json()) as { amount?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const amount =
    typeof body.amount === 'number' && body.amount > 0
      ? Math.trunc(body.amount)
      : 6

  // getOrCreateAnonId mints the cookie on the fly if a freshly-wiped dev
  // session has none yet — keeps the dev shortcut working from a totally
  // clean state.
  const [anonId, email] = await Promise.all([
    getOrCreateAnonId(),
    readSessionEmail(),
  ])

  try {
    const granted = await grantCredits(
      { anonId, email },
      { amount, reason: REASONS.DEV_GRANT },
    )
    return NextResponse.json({
      creditsRemaining: granted.remaining,
      amount,
    })
  } catch (err) {
    console.error('dev/grant-credits failed', err)
    return NextResponse.json({ error: 'grant failed' }, { status: 500 })
  }
}
