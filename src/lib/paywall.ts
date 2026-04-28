// Shared paywall error. Thrown by both postWithTimeout (page.tsx, the
// non-streaming path) and streamScene (the streaming path) when the
// server returns a 402 from a credit-debit. Caller catches → opens
// the paywall overlay via creditsExhausted().
export class PaywallRequiredError extends Error {
  balance: number
  constructor(balance: number) {
    super('paywall_required')
    this.name = 'PaywallRequiredError'
    this.balance = balance
  }
}
