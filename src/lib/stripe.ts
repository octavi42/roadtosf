import Stripe from 'stripe'

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set. See .env.example.')
  }
  cached = new Stripe(key)
  return cached
}

export const PAYWALL_PRICE_USD_CENTS = 499
