import { Resend } from 'resend'

let cached: Resend | null = null

function getResend(): Resend {
  if (cached) return cached
  const key = process.env.RESEND_API_KEY
  if (!key) {
    throw new Error('RESEND_API_KEY is not set. See .env.example.')
  }
  cached = new Resend(key)
  return cached
}

// Resend's onboarding sender works without domain verification but only
// delivers to the address that owns the Resend account. For real testing,
// set RESEND_FROM to a verified-domain address.
const FROM = process.env.RESEND_FROM ?? 'onboarding@resend.dev'

// Loud warning so an unset RESEND_FROM in production doesn't quietly
// bounce every recipient that isn't the Resend account owner.
if (!process.env.RESEND_FROM && process.env.NODE_ENV === 'production') {
  console.warn(
    '[email] RESEND_FROM is unset — falling back to onboarding@resend.dev. ' +
      'Resend will only deliver to the account-owner email; all other ' +
      'recipients will bounce. Set RESEND_FROM to a verified-domain address.',
  )
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const resend = getResend()
  // Resend's send() resolves with {data, error}; sandbox restrictions
  // (e.g. "You can only send to your own address until you verify a domain")
  // come back via `error`, not as a thrown rejection.
  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your Road to SF code: ${code}`,
    text: [
      `Your code is ${code}.`,
      ``,
      `It expires in 10 minutes.`,
      `If you didn't ask for this, you can ignore this email.`,
    ].join('\n'),
  })
  if (error) {
    throw new Error(`resend: ${error.message}`)
  }
}
