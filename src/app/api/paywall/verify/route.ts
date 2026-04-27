import { NextResponse } from 'next/server'
import { getStripe, getPack, PACKS } from '@/lib/stripe'
import { markPlaythroughPaid } from '@/lib/playthroughs'
import { setSessionEmail } from '@/lib/auth'

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

    // Defense in depth: don't trust just the status. Confirm the charge was
    // for the price of the pack named in the intent's metadata, in the
    // currency we asked for. Stops accidental bypasses if a future endpoint
    // creates intents on the same Stripe account with a 'playthroughId'
    // metadata key.
    const pack = getPack(intent.metadata?.packId) ?? PACKS.normal
    const paid =
      intent.status === 'succeeded' &&
      intent.amount === pack.priceCents &&
      intent.currency === 'usd'
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

    // Auto-issue a login session for the paying email so they can revisit
    // their history later without going through the OTP flow. Best-effort:
    // session-cookie failure must not roll back a successful payment.
    if (email) {
      try {
        await setSessionEmail(email)
      } catch (err) {
        console.error('paywall/verify: setSessionEmail failed', err)
      }
    }

    return NextResponse.json({
      paid: true,
      packId: pack.id,
      playsGranted: pack.plays,
    })
  } catch (err) {
    console.error('paywall/verify failed', err)
    return NextResponse.json({ error: 'stripe error' }, { status: 500 })
  }
}
