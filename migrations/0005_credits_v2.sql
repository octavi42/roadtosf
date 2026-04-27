/*
  Switches the paywall from "1 play = 1 full playthrough" to "1 credit = 1
  LLM-generated group of 4 sub-scenes". Pack values change too: $5 = 6
  credits, $15 = 20 credits (see src/lib/packs.ts and BUSINESS.md).

  Idempotent: only drops the prior user_balance when the v1 schema (the
  plays_remaining column) is detected. After this runs once, the v1
  columns no longer exist, so the DO block becomes a no-op and re-running
  the migration set is safe.

  WARNING: scripts/migrate.mjs splits on `;\s*\n` and then drops any
  chunk that *starts* with `--`. That's why this header is a /* */ block
  comment and the DO block stays on one physical line — both required to
  survive that splitter. If you add inter-statement notes, use /* */
  inline or risk silently dropping the next CREATE.
*/

DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_balance' AND column_name = 'plays_remaining') THEN DROP TABLE user_balance CASCADE; END IF; END $$;

CREATE TABLE IF NOT EXISTS user_balance (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id                  UUID,
  email                    TEXT,
  credits_remaining        INT         NOT NULL DEFAULT 0 CHECK (credits_remaining >= 0),
  total_credits_purchased  INT         NOT NULL DEFAULT 0 CHECK (total_credits_purchased >= 0),
  byo_api_key_encrypted    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_balance_email_uniq
  ON user_balance (LOWER(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_balance_anon_id_uniq
  ON user_balance (anon_id)
  WHERE anon_id IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS credit_ledger_balance_idx
  ON credit_ledger (balance_id, created_at DESC);
