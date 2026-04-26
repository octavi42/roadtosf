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
 * Atomically consume the most recent active code for this email if the
 * supplied code matches. Returns true on success, false otherwise.
 *
 * Single SQL statement so SELECT-then-UPDATE TOCTOU is impossible — under
 * READ COMMITTED, concurrent UPDATEs serialize on the row lock and re-evaluate
 * the WHERE clause against the post-lock row state. After one success, used_at
 * is no longer NULL and subsequent UPDATEs match no rows. After MAX_ATTEMPTS
 * misses, attempts is no longer < MAX_ATTEMPTS and increments stop.
 *
 * Failure modes (all return false): no active code, expired, max attempts
 * reached, code mismatch (increments attempts).
 */
export async function checkAndConsumeEmailCode(
  email: string,
  code: string,
): Promise<boolean> {
  const sql = getSql()
  const codeHash = hashCode(code)
  const rows = await sql`
    UPDATE paywall_email_codes
    SET
      used_at  = CASE WHEN code_hash = ${codeHash} THEN NOW() ELSE used_at END,
      attempts = CASE WHEN code_hash = ${codeHash} THEN attempts ELSE attempts + 1 END
    WHERE id = (
      SELECT id FROM paywall_email_codes
      WHERE LOWER(email) = LOWER(${email})
        AND expires_at > NOW()
        AND used_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    )
      AND used_at IS NULL
      AND attempts < ${MAX_ATTEMPTS}
    RETURNING (code_hash = ${codeHash}) AS matched
  `
  if (rows.length === 0) return false
  const row = rows[0] as { matched: boolean }
  return row.matched === true
}
