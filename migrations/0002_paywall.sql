-- Stripe paywall — track payment state per playthrough.
-- paid_at is the server-verified payment timestamp (set by /api/paywall/verify
-- after Stripe confirms payment_status === "paid"). stripe_session_id is kept
-- for traceability so we can reconcile against Stripe's dashboard if needed.

ALTER TABLE playthroughs
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

CREATE INDEX IF NOT EXISTS playthroughs_paid_at_idx
  ON playthroughs (paid_at) WHERE paid_at IS NOT NULL;
