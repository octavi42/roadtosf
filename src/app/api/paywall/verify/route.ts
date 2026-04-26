import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { markPlaythroughPaid } from '@/lib/playthroughs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = { paymentIntentId?: unknown; email?: unknown }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const paymentIntentId =
    typeof body.paymentIntentId === 'string' ? body.paymentIntentId : ''
  if (!paymentIntentId) {
    return NextResponse.json(
      { error: 'missing paymentIntentId' },
      { status: 400 },
    )
  }

  try {
    const stripe = getStripe()
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId)

    const paid = intent.status === 'succeeded'
    if (!paid) {
      return NextResponse.json({ paid: false })
    }

    // Trust gate: only flip the row after Stripe says succeeded.
    // playthroughId is read from metadata set when the intent was created.
    const playthroughId = intent.metadata?.playthroughId
    if (typeof playthroughId !== 'string' || !UUID_RE.test(playthroughId)) {
      console.error('paywall/verify: bad playthroughId in metadata', {
        paymentIntentId,
        playthroughId,
      })
      return NextResponse.json(
        { error: 'intent missing playthroughId metadata' },
        { status: 500 },
      )
    }

    const email =
      typeof body.email === 'string' && EMAIL_RE.test(body.email)
        ? body.email
        : null
    const updated = await markPlaythroughPaid({
      id: playthroughId,
      stripeSessionId: intent.id,
      email,
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
