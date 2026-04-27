-- Switches the paywall from "1 play = 1 full playthrough" to "1 credit = 1
-- LLM-generated group of 4 sub-scenes". Pack values change too: $5 = 6
-- credits, $15 = 20 credits (see src/lib/packs.ts and BUSINESS.md).
--
-- Drops user_balance and rebuilds because the prior row was email-PK only —
-- the new model needs anon_id keying so we can debit before the user has
-- given us an email (e.g. dev grants, future free tier). No data loss in
-- practice: nothing in the prior code path ever wrote to user_balance.

DROP TABLE IF EXISTS user_balance CASCADE;

CREATE TABLE user_balance (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id                  UUID,
  email                    TEXT,
  credits_remaining        INT         NOT NULL DEFAULT 0 CHECK (credits_remaining >= 0),
  total_credits_purchased  INT         NOT NULL DEFAULT 0 CHECK (total_credits_purchased >= 0),
  byo_api_key_encrypted    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email is case-insensitive unique. Anon row is unique per cookie. Both
-- columns are nullable because a row may exist as email-only (after
-- bind/merge) or anon-only (pre-payment dev grants).
CREATE UNIQUE INDEX user_balance_email_uniq
  ON user_balance (LOWER(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX user_balance_anon_id_uniq
  ON user_balance (anon_id)
  WHERE anon_id IS NOT NULL;

-- Audit trail for every credit movement. Lets us answer "why did this user
-- run out of credits?" without spelunking server logs.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id      UUID        NOT NULL REFERENCES user_balance(id) ON DELETE CASCADE,
  delta           INT         NOT NULL,
  reason          TEXT        NOT NULL,
  playthrough_id  UUID        REFERENCES playthroughs(id) ON DELETE SET NULL,
  episode_index   INT,
  group_index     INT,
  llm_index       INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX credit_ledger_balance_idx
  ON credit_ledger (balance_id, created_at DESC);
