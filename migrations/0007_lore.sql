/*
  Road to SF — lore corpus schema. Backs the picker pipeline described in
  LORE_SYSTEM.md §2.

  Three tables, one per dataset:
    - sf_events   : scraped weekly from Luma / Partiful / cerebralvalley
    - sf_people   : ~50 hand-curated SF figures, source-of-truth lives in
                    src/lib/lore/people-seed.json (this table is upserted)
    - sf_stories  : scraped weekly from HN Algolia + Reddit JSON + Substack
                    RSS, beat field is LLM-summarized at scrape time

  scripts/migrate.mjs splits on `;\s*\n` and drops chunks starting with `--`,
  so this header is a /* */ block to survive the splitter. Same trick as
  0006_silicon_mania.sql.

  PR note: spec'd as 0004_lore.sql in LORE_SYSTEM.md §6, but 0004 was already
  taken by 0004_credits.sql when the spec was written. Bumped to 0007.
*/

CREATE TABLE IF NOT EXISTS sf_people (
  id                TEXT        PRIMARY KEY,
  display_name      TEXT        NOT NULL,
  role              TEXT        NOT NULL,
  vibe              TEXT        NOT NULL,
  regular_spots     TEXT[]      NOT NULL DEFAULT '{}',
  x_handle          TEXT,
  encounter_styles  TEXT[]      NOT NULL DEFAULT '{}',
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  achievement_hook  TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sf_people_role_idx ON sf_people (role);

CREATE TABLE IF NOT EXISTS sf_events (
  id                TEXT        PRIMARY KEY,
  name              TEXT        NOT NULL,
  venue             TEXT        NOT NULL,
  start_at          TIMESTAMPTZ NOT NULL,
  host              TEXT,
  url               TEXT,
  blurb             TEXT,
  known_attendees   TEXT[]      NOT NULL DEFAULT '{}',
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  scraped_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sf_events_start_at_idx   ON sf_events (start_at);
CREATE INDEX IF NOT EXISTS sf_events_scraped_at_idx ON sf_events (scraped_at DESC);

CREATE TABLE IF NOT EXISTS sf_stories (
  id                       TEXT        PRIMARY KEY,
  beat                     TEXT        NOT NULL,
  tone                     TEXT        NOT NULL,
  source_url               TEXT        NOT NULL,
  applicable_archetypes    TEXT[]      NOT NULL DEFAULT '{}',
  tags                     TEXT[]      NOT NULL DEFAULT '{}',
  scraped_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sf_stories_scraped_at_idx ON sf_stories (scraped_at DESC);
CREATE INDEX IF NOT EXISTS sf_stories_tone_idx       ON sf_stories (tone);
