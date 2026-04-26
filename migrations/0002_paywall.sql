ALTER TABLE playthroughs
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

CREATE INDEX IF NOT EXISTS playthroughs_paid_at_idx
  ON playthroughs (paid_at) WHERE paid_at IS NOT NULL;
