/*
  Snapshot of Silicon Mania Weekly digest items (https://www.siliconmania.tv/weekly).
  Populated by POST /api/admin/refresh-weekly. Read by the arc-gen pipeline
  to splice real-world SF tech beats into a playthrough as fate.

  PK is (week, id) so re-ingesting the same week is idempotent (UPSERT) and
  multiple weeks coexist for future replay/seasonal flavor.

  scripts/migrate.mjs splits on `;\s*\n` and drops chunks starting with `--`,
  so this header is a /* */ block to survive the splitter.
*/

CREATE TABLE IF NOT EXISTS silicon_mania_items (
  week        TEXT        NOT NULL,
  id          TEXT        NOT NULL,
  headline    TEXT        NOT NULL,
  summary     TEXT        NOT NULL,
  image_url   TEXT,
  category    TEXT,
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  people      TEXT[]      NOT NULL DEFAULT '{}',
  companies   TEXT[]      NOT NULL DEFAULT '{}',
  vcs         TEXT[]      NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week, id)
);

CREATE INDEX IF NOT EXISTS silicon_mania_items_week_idx ON silicon_mania_items (week);
CREATE INDEX IF NOT EXISTS silicon_mania_items_category_idx ON silicon_mania_items (category) WHERE category IS NOT NULL;
