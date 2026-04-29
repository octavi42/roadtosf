# Lore Picker — Phase 1-3 Implementation Brief

You are implementing **Phases 1-3 only** of `LORE_SYSTEM.md` in this worktree.
Do not touch Phases 4-5 in this round — another parallel agent is editing the
same prompt files in a different worktree and we want a clean merge.

## Read first, in order

1. `LORE_SYSTEM.md` (this is the spec — full design is here)
2. `AGENTS.md` (Next.js convention notes — heed the deprecation warning)
3. `CLAUDE.md` (game design context — but DO NOT edit it in this PR; that's
   Phase 4)
4. `src/lib/prompts/arc.ts`, `src/lib/lore.ts`, `src/lib/db.ts`,
   `migrations/0001_init.sql`, `scripts/migrate.mjs`
   (existing patterns to mirror)

## Scope (Phases 1-3 from `LORE_SYSTEM.md` §6)

### Phase 1 — data layer

- `migrations/0004_lore.sql` — schema for `sf_events`, `sf_people`,
  `sf_stories` per `LORE_SYSTEM.md` §2.
- `src/lib/lore/people-seed.json` — hand-curate **~50 SF figures** (founders,
  VCs, journalists, operators). Match the schema in §2.2. Drop a draft and
  **stop before running `seed-people.mjs` against the DB** — the user wants to
  review the names first.
- `scripts/seed-people.mjs` — upsert `people-seed.json` into `sf_people`.
  Mirror the pattern of `scripts/migrate.mjs`.
- `scripts/scrape-stories.mjs` — HN Algolia + Reddit JSON + Substack RSS
  (sources in §2.3). LLM-summarize each story via Anthropic Haiku
  (`MODELS.scene` from `src/lib/anthropic.ts`) into a ≤220-char `beat`. Insert
  into `sf_stories`.
- `scripts/scrape-events.mjs` — Luma + Partiful + cerebralvalley public HTML.
  Add a `--from-screenshots references/silicon-mania/*.png` flag that uses
  Claude vision to extract events from the existing screenshots.
- **No Twitter/X scraping** — explicitly excluded (cost).

### Phase 2 — candidates module

- `src/lib/lore/candidates.ts` — pure-TS implementation of the Stage 1
  scoring in `LORE_SYSTEM.md` §3.1. Reuse `mulberry32` from `src/lib/lore.ts`.
- `src/lib/lore/lore-db.ts` — Stage 0 SQL helpers (read-only queries against
  the three new tables).
- Add Vitest if not present (`package.json` doesn't have it yet — check
  first).
- Unit tests for: tag overlap scoring, recency boost, exclusion via
  `alreadyEncountered`, stat-bias for `sam-altman` at hype ≥ 4, mulberry32
  determinism (same seed → same picks).

### Phase 3 — picker route

- `src/lib/schemas/picker.ts` — Zod schema for picker output, plus a
  validator that drops hallucinated IDs not present in the candidate set.
- `src/lib/prompts/picker.ts` — the picker prompt per `LORE_SYSTEM.md` §3.2.
  System block cached. Mirror the structure of `src/lib/prompts/arc.ts`
  (system blocks + user blocks pattern).
- `src/app/api/pick-lore/route.ts` — wires Stages 0 → 1 → 2 → 3. Body and
  response shape per `LORE_SYSTEM.md` §4.2. Falls back to deterministic-only
  picks if Haiku throws (`LORE_SYSTEM.md` §3.4).

## Out of scope (DO NOT TOUCH in this PR)

- `src/lib/prompts/arc.ts`
- `src/lib/prompts/scene.ts`
- `src/app/api/generate-arc/route.ts`
- `src/app/api/generate-scene/route.ts`
- `src/lib/types.ts`
- `src/lib/session.ts`
- `src/app/page.tsx`
- `CLAUDE.md`
- `vercel.json`

These are owned by the parallel agent or by a follow-up PR. Touching them
will conflict.

## Verification gates

- After Phase 1: `npm run db:migrate` applies cleanly. Manual scrape run
  inserts ≥10 rows each into `sf_events` and `sf_stories`.
  `people-seed.json` has ~50 entries. **Don't run `seed-people.mjs`** yet —
  wait for user review.
- After Phase 2: `npm test` passes. Determinism test (same seed → same picks)
  is the load-bearing one.
- After Phase 3: `curl -X POST localhost:3000/api/pick-lore -d
  @fixtures/picker-input.json` returns valid hydrated picks with sensible
  IDs.

## Constraints

- Real names ARE allowed (`LORE_SYSTEM.md` §1) — but the no-real-names rule
  in `src/lib/prompts/arc.ts` stays in place this round (Phase 4 flips it).
  The picker can return Sam Altman's ID; arc-gen still archetypes him until
  Phase 4 lands.
- Use Neon via `getSql()` from `src/lib/db.ts`. Do not introduce a different
  DB client.
- Anthropic via `src/lib/anthropic.ts` (`completeJson`, `MODELS.scene` for
  Haiku). Mirror the existing route patterns for body coercion, tolerant JSON
  extraction, and Zod validation (see `src/app/api/generate-arc/route.ts` and
  `src/app/api/extract-facts/route.ts`).
- Heed `AGENTS.md`: read `node_modules/next/dist/docs/` before writing
  Next.js APIs.

## Deliverable

A draft PR `feat/lore-picker` → `main` containing Phases 1-3 only. Include in
the PR description:

- Row counts after first scrape run.
- Sample picker output for 2-3 fixture inputs.
- Open TODOs for Phase 4 (so the next agent has continuity).

If you hit anything ambiguous, **STOP and ask** in the PR description rather
than guess.
