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
    const session = await stripe.checkout.sessions.create({
      // Stripe API 2026-04-22 renamed the embedded UI mode value from
      // 'embedded' to 'embedded_page'. The wire protocol/component is the same.
      ui_mode: 'embedded_page',
      mode: 'payment',
      redirect_on_completion: 'never',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: PAYWALL_PRICE_USD_CENTS,
            product_data: {
              name: 'Road to SF — capital for the trip',
              description: 'One-time charge unlocks the next two acts.',
            },
          },
        },
      ],
      metadata: { playthroughId },
    })

    if (!session.client_secret) {
      return NextResponse.json(
        { error: 'stripe returned no client_secret' },
        { status: 502 },
      )
    }

    return NextResponse.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    })
  } catch (err) {
    console.error('paywall/checkout failed', err)
    return NextResponse.json({ error: 'stripe error' }, { status: 500 })
  }
}
