CREATE TABLE IF NOT EXISTS user_balance (
  email                  TEXT PRIMARY KEY,
  plays_remaining        INT NOT NULL DEFAULT 0 CHECK (plays_remaining >= 0),
  total_purchased        INT NOT NULL DEFAULT 0 CHECK (total_purchased >= 0),
  byo_api_key_encrypted  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playthrough_id  UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT,
  input_tokens    INT,
  output_tokens   INT,
  cached_tokens   INT,
  tts_chars       INT,
  image_count     INT,
  wall_ms         INT,
  cost_usd_micros BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usage_log_playthrough_id_idx
  ON usage_log (playthrough_id);

CREATE INDEX IF NOT EXISTS usage_log_created_at_idx
  ON usage_log (created_at DESC);

ALTER TABLE playthroughs
  ADD COLUMN IF NOT EXISTS pack_id       TEXT,
  ADD COLUMN IF NOT EXISTS consumed_play BOOLEAN NOT NULL DEFAULT FALSE;
