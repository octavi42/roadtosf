-- Road to SF — playthrough capture schema.
-- Apply via: npm run db:migrate
-- Or paste into the Neon SQL editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS playthroughs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id             UUID NOT NULL,
  email               TEXT,
  is_paid             BOOLEAN NOT NULL DEFAULT FALSE,
  startup_name        TEXT,
  startup_description TEXT,
  self_description    TEXT,
  flavor_tags         JSONB NOT NULL DEFAULT '[]'::jsonb,
  intro_transcript    TEXT,
  arc_json            JSONB,
  ending              TEXT,
  epilogue            TEXT,
  achievements        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS playthroughs_anon_id_idx     ON playthroughs (anon_id);
CREATE INDEX IF NOT EXISTS playthroughs_created_at_idx  ON playthroughs (created_at DESC);
CREATE INDEX IF NOT EXISTS playthroughs_email_idx       ON playthroughs (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS playthroughs_ending_idx      ON playthroughs (ending) WHERE ending IS NOT NULL;

CREATE TABLE IF NOT EXISTS scene_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playthrough_id    UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
  scene_number      INT NOT NULL,
  dialogue          TEXT,
  choices_shown     JSONB NOT NULL DEFAULT '[]'::jsonb,
  choice_picked     TEXT,
  free_text         TEXT,
  was_timeout       BOOLEAN NOT NULL DEFAULT FALSE,
  time_to_choose_ms INT,
  stat_deltas       JSONB NOT NULL DEFAULT '{}'::jsonb,
  tonal_flag        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scene_events_playthrough_id_idx ON scene_events (playthrough_id);
CREATE INDEX IF NOT EXISTS scene_events_scene_number_idx   ON scene_events (scene_number);
