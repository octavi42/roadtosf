import { createHash, randomInt } from 'node:crypto'
import { getSql } from './db'

const TTL_MS = 10 * 60 * 1000
const RATE_LIMIT_MS = 60 * 1000
const MAX_ATTEMPTS = 5

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export type IssueResult =
  | { kind: 'sent'; code: string }
  | { kind: 'rate_limited' }

export async function issueEmailCode(email: string): Promise<IssueResult> {
  const sql = getSql()
  const recent = await sql`
    SELECT 1 FROM paywall_email_codes
    WHERE LOWER(email) = LOWER(${email})
      AND created_at > NOW() - (${RATE_LIMIT_MS / 1000} || ' seconds')::interval
    LIMIT 1
  `
  if (recent.length > 0) return { kind: 'rate_limited' }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
  await sql`
    INSERT INTO paywall_email_codes (email, code_hash, expires_at)
    VALUES (${email}, ${hashCode(code)}, ${expiresAt})
  `
  return { kind: 'sent', code }
}

/**
 * Look up the most recent active code for this email and consume it if
 * the supplied code matches. Returns true on success, false otherwise.
 *
 * Failure modes (all return false): no active code, expired, max attempts
 * reached, code mismatch (increments attempts).
 */
export async function checkAndConsumeEmailCode(
  email: string,
  code: string,
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, code_hash, attempts
    FROM paywall_email_codes
    WHERE LOWER(email) = LOWER(${email})
      AND expires_at > NOW()
      AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (rows.length === 0) return false
  const row = rows[0] as {
    id: string
    code_hash: string
    attempts: number
  }
  if (row.attempts >= MAX_ATTEMPTS) return false

  if (row.code_hash !== hashCode(code)) {
    await sql`
      UPDATE paywall_email_codes SET attempts = attempts + 1
      WHERE id = ${row.id}
    `
    return false
  }

  await sql`
    UPDATE paywall_email_codes SET used_at = NOW()
    WHERE id = ${row.id}
  `
  return true
}
