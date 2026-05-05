// Server-side credit accounting. 1 credit = 1 LLM-generated "group" of 4
// sub-scenes (one shared image, one Sonnet call per sub-scene, four TTS
// lines). Costs ~$0.42/group; pack pricing in src/lib/packs.ts.
//
// Identity: balance rows are keyed by anon_id (cookie) for pre-payment users
// and by email after they pay. bindAnonToEmail merges any anon row into the
// email row at payment time.

import { getSql } from './db'

export class InsufficientCreditsError extends Error {
  constructor(public readonly balance: number) {
    super('insufficient_credits')
    this.name = 'InsufficientCreditsError'
  }
}

export interface BalanceKey {
  anonId: string | null
  email: string | null
}

export interface DebitOpts {
  amount?: number
  reason: string
  playthroughId?: string | null
  episodeIndex?: number | null
  groupIndex?: number | null
  llmIndex?: number | null
}

export interface GrantOpts {
  amount: number
  reason: string
  playthroughId?: string | null
}

const CREDIT_REASON_DEV = 'dev_grant'

// One-time grant on first playthrough creation per anon cookie. Sized to
// cover a full run with buffer; matches the Normal pack so judges and
// first-time visitors get the complete experience before the paywall.
export const FREE_PLAYTHROUGH_CREDITS = 6

function normalizeEmail(email: string | null): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Returns 0 when no balance row exists for the caller. Caller's email wins
 * over anon_id when both are present.
 *
 * Anon-id-only lookups are restricted to rows where `email IS NULL` —
 * "truly anonymous" credits (e.g. dev grants on a fresh cookie). Once a
 * row has been bound to an email (via bindAnonToEmail at payment or OTP
 * login), it can only be reached by authenticating with that email. This
 * is what makes logout actually log you out: even though the anon cookie
 * survives, the bound credits become unreachable until you sign back in.
 */
export async function getBalance(key: BalanceKey): Promise<number> {
  const email = normalizeEmail(key.email)
  const anonId = key.anonId
  if (!email && !anonId) return 0
  const sql = getSql()
  const rows = email
    ? await sql`
        SELECT credits_remaining FROM user_balance
        WHERE LOWER(email) = ${email}
        LIMIT 1
      `
    : await sql`
        SELECT credits_remaining FROM user_balance
        WHERE anon_id = ${anonId} AND email IS NULL
        LIMIT 1
      `
  if (rows.length === 0) return 0
  return Number((rows[0] as { credits_remaining: number }).credits_remaining)
}

/**
 * Atomic check-and-decrement on the balance row identified by the caller.
 * Throws InsufficientCreditsError when the row is missing or the balance is
 * below `amount`. Writes a credit_ledger row on success (best effort: a
 * ledger insert failure does NOT roll back the debit, since Neon HTTP has no
 * cross-statement transactions).
 */
export async function debitCredit(
  key: BalanceKey,
  opts: DebitOpts,
): Promise<{ remaining: number; balanceId: string }> {
  const amount = opts.amount ?? 1
  if (amount <= 0) throw new Error('debitCredit: amount must be > 0')
  const email = normalizeEmail(key.email)
  const anonId = key.anonId

  const sql = getSql()
  const rows = email
    ? await sql`
        UPDATE user_balance
        SET credits_remaining = credits_remaining - ${amount},
            updated_at = NOW()
        WHERE LOWER(email) = ${email}
          AND credits_remaining >= ${amount}
        RETURNING id, credits_remaining
      `
    : anonId
      ? await sql`
          UPDATE user_balance
          SET credits_remaining = credits_remaining - ${amount},
              updated_at = NOW()
          WHERE anon_id = ${anonId}
            AND email IS NULL
            AND credits_remaining >= ${amount}
          RETURNING id, credits_remaining
        `
      : []

  if (rows.length === 0) {
    const current = await getBalance(key)
    throw new InsufficientCreditsError(current)
  }

  const row = rows[0] as { id: string; credits_remaining: number }
  try {
    await sql`
      INSERT INTO credit_ledger (
        balance_id, delta, reason, playthrough_id,
        episode_index, group_index, llm_index
      ) VALUES (
        ${row.id}, ${-amount}, ${opts.reason},
        ${opts.playthroughId ?? null},
        ${opts.episodeIndex ?? null},
        ${opts.groupIndex ?? null},
        ${opts.llmIndex ?? null}
      )
    `
  } catch (err) {
    console.error('credit_ledger insert failed (non-fatal)', err)
  }
  return { remaining: Number(row.credits_remaining), balanceId: row.id }
}

/**
 * Adds credits to the caller's balance row, creating it if missing. Used by
 * the Stripe verify endpoint after a successful charge and by dev tooling.
 *
 * If both anon_id and email are present, prefers the email row (and merges
 * any anon-only row into it via bindAnonToEmail). If only anon_id is
 * present, an anon-keyed row is created/updated.
 */
export async function grantCredits(
  key: BalanceKey,
  opts: GrantOpts,
): Promise<{ remaining: number; balanceId: string }> {
  if (opts.amount <= 0) throw new Error('grantCredits: amount must be > 0')
  const email = normalizeEmail(key.email)
  const anonId = key.anonId

  if (email && anonId) {
    await bindAnonToEmail(anonId, email)
  }

  const sql = getSql()
  let row: { id: string; credits_remaining: number } | undefined

  // Two-phase upsert: try UPDATE first, INSERT on miss. Avoids ON CONFLICT
  // with partial unique indexes (which Postgres requires the predicate to
  // match exactly, fragile under future schema tweaks). Race risk is
  // acceptable here: payment verify is single-threaded per user.
  if (email) {
    const updated = await sql`
      UPDATE user_balance
      SET credits_remaining = credits_remaining + ${opts.amount},
          total_credits_purchased = total_credits_purchased + ${opts.amount},
          updated_at = NOW()
      WHERE LOWER(email) = ${email}
      RETURNING id, credits_remaining
    `
    if (updated.length > 0) {
      row = updated[0] as { id: string; credits_remaining: number }
    } else {
      const inserted = await sql`
        INSERT INTO user_balance (email, anon_id, credits_remaining, total_credits_purchased)
        VALUES (${email}, ${anonId}, ${opts.amount}, ${opts.amount})
        RETURNING id, credits_remaining
      `
      row = inserted[0] as { id: string; credits_remaining: number }
    }
  } else if (anonId) {
    const updated = await sql`
      UPDATE user_balance
      SET credits_remaining = credits_remaining + ${opts.amount},
          total_credits_purchased = total_credits_purchased + ${opts.amount},
          updated_at = NOW()
      WHERE anon_id = ${anonId} AND email IS NULL
      RETURNING id, credits_remaining
    `
    if (updated.length > 0) {
      row = updated[0] as { id: string; credits_remaining: number }
    } else {
      const inserted = await sql`
        INSERT INTO user_balance (anon_id, credits_remaining, total_credits_purchased)
        VALUES (${anonId}, ${opts.amount}, ${opts.amount})
        RETURNING id, credits_remaining
      `
      row = inserted[0] as { id: string; credits_remaining: number }
    }
  } else {
    throw new Error('grantCredits: missing both email and anonId')
  }

  if (!row) throw new Error('grantCredits: upsert returned no row')

  try {
    await sql`
      INSERT INTO credit_ledger (
        balance_id, delta, reason, playthrough_id
      ) VALUES (
        ${row.id}, ${opts.amount}, ${opts.reason},
        ${opts.playthroughId ?? null}
      )
    `
  } catch (err) {
    console.error('credit_ledger insert failed (non-fatal)', err)
  }

  return { remaining: Number(row.credits_remaining), balanceId: row.id }
}

/**
 * Merges any anon-only balance row into the email row. Called when a user
 * pays for the first time (we have both their cookie anon_id and their
 * email). Idempotent — a no-op if no anon row exists, or if the anon row is
 * the same row that already carries the email.
 */
export async function bindAnonToEmail(
  anonId: string,
  email: string,
): Promise<void> {
  const normEmail = normalizeEmail(email)
  if (!normEmail || !anonId) return
  const sql = getSql()

  const anonRows = await sql`
    SELECT id, credits_remaining, total_credits_purchased
    FROM user_balance
    WHERE anon_id = ${anonId}
    LIMIT 1
  `
  if (anonRows.length === 0) return
  const anonRow = anonRows[0] as {
    id: string
    credits_remaining: number
    total_credits_purchased: number
  }

  const emailRows = await sql`
    SELECT id FROM user_balance
    WHERE LOWER(email) = ${normEmail}
    LIMIT 1
  `

  if (emailRows.length === 0) {
    // No email row yet — claim this anon row as the email row AND release
    // the anon_id. After this, getBalance({email}) finds the credits via
    // email; getBalance({anonId}) does not (email IS NULL filter), which
    // is what makes logout actually log out. The cookie can also be
    // reused for a fresh anon-only grant later without colliding with
    // the unique anon_id index.
    await sql`
      UPDATE user_balance
      SET email = ${normEmail}, anon_id = NULL, updated_at = NOW()
      WHERE id = ${anonRow.id}
    `
    return
  }

  const emailRowId = (emailRows[0] as { id: string }).id
  if (emailRowId === anonRow.id) return // already merged

  // Move credits + ledger references onto the email row, then drop the
  // anon-only row. Done in two statements: the email row update first (so
  // ledger rows still resolve through CASCADE if anything fails before the
  // delete), then the anon delete. The email row deliberately does NOT
  // pick up the anon_id — bound credits stay reachable only via email
  // auth, which is the contract the rest of the lookup logic relies on.
  await sql`
    UPDATE user_balance
    SET credits_remaining = credits_remaining + ${anonRow.credits_remaining},
        total_credits_purchased = total_credits_purchased
                                 + ${anonRow.total_credits_purchased},
        updated_at = NOW()
    WHERE id = ${emailRowId}
  `
  await sql`
    UPDATE credit_ledger
    SET balance_id = ${emailRowId}
    WHERE balance_id = ${anonRow.id}
  `
  await sql`DELETE FROM user_balance WHERE id = ${anonRow.id}`
}

export const REASONS = {
  STRIPE_PURCHASE: 'stripe_purchase',
  GROUP_DEBIT: 'group_debit',
  EPISODE_DEBIT: 'episode_debit',
  SCENE_DEBIT: 'scene_debit',
  DEV_GRANT: CREDIT_REASON_DEV,
  FREE_PLAYTHROUGH: 'free_playthrough',
} as const

// Worst-case scenes per LLM episode (EPISODE_LENGTH_MAX in
// src/lib/session.ts). Episodes are gated on this floor so a player
// never starts an episode they can't finish — paywall fires between
// episodes only.
export const EPISODE_FLOOR = 5
