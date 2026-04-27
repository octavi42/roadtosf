CREATE TABLE IF NOT EXISTS paywall_email_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paywall_email_codes_email_idx
  ON paywall_email_codes (LOWER(email));

CREATE INDEX IF NOT EXISTS paywall_email_codes_expires_at_idx
  ON paywall_email_codes (expires_at);
