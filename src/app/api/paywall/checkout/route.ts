import { NextResponse } from 'next/server'
import { getStripe, PAYWALL_PRICE_USD_CENTS } from '@/lib/stripe'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = { playthroughId?: unknown }

export async function POST(request: Request) {
  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const playthroughId =
    typeof body.playthroughId === 'string' ? body.playthroughId : ''
  if (!UUID_RE.test(playthroughId)) {
    return NextResponse.json({ error: 'invalid playthroughId' }, { status: 400 })
  }

  try {
    const stripe = getStripe()
    const intent = await stripe.paymentIntents.create({
      amount: PAYWALL_PRICE_USD_CENTS,
      currency: 'usd',
      // No redirect-based methods so we can confirm fully client-side
      // and trigger onSatisfied() inline on success.
      payment_method_types: ['card'],
      metadata: { playthroughId },
    })

    if (!intent.client_secret) {
      return NextResponse.json(
        { error: 'stripe returned no client_secret' },
        { status: 502 },
      )
    }

    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
    })
  } catch (err) {
    console.error('paywall/checkout failed', err)
    return NextResponse.json({ error: 'stripe error' }, { status: 500 })
  }
}
