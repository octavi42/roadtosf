import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { markPlaythroughPaid } from '@/lib/playthroughs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = { sessionId?: unknown }

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'missing sessionId' }, { status: 400 })
  }

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    const paid = session.payment_status === 'paid'
    if (!paid) {
      return NextResponse.json({ paid: false })
    }

    // Trust gate: only flip the row after Stripe confirms paid status.
    // playthroughId comes from session metadata, set when the session was created.
    const playthroughId = session.metadata?.playthroughId
    if (typeof playthroughId !== 'string' || !UUID_RE.test(playthroughId)) {
      console.error('paywall/verify: bad playthroughId in metadata', {
        sessionId,
        playthroughId,
      })
      return NextResponse.json(
        { error: 'session missing playthroughId metadata' },
        { status: 500 },
      )
    }

    const updated = await markPlaythroughPaid({
      id: playthroughId,
      stripeSessionId: session.id,
    })
    if (!updated) {
      return NextResponse.json(
        { error: 'playthrough not found' },
        { status: 404 },
      )
    }

    return NextResponse.json({ paid: true })
  } catch (err) {
    console.error('paywall/verify failed', err)
    return NextResponse.json({ error: 'stripe error' }, { status: 500 })
  }
}
