import Stripe from 'stripe'

export { PACKS, getPack, type Pack, type PackId } from './packs'
import { PACKS } from './packs'

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

// Legacy single-price export — keep for any old code path that hasn't
// migrated yet. Points at the default (normal) pack.
export const PAYWALL_PRICE_USD_CENTS = PACKS.normal.priceCents
