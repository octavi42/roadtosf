# Road to SF — Lore System (Real Names + Picker)

Implementation plan for grounding the arc/episode generator in real SF events,
real people, and real scraped stories. Replaces the "archetype only / no real
names" rule from `CLAUDE.md`.

> **Status**: Plan locked. Implementation pending.
> **Branch**: `feat/lore-picker` (separate worktree).
> **Author session**: Apr 29 design + brainstorm.

---

## 1. Design pivot

The previous rule (CLAUDE.md, "Real people are NEVER named — archetype them") is
**dropped**. New rule:

- **Real names are allowed** for events, venues, founders, VCs, journalists.
- **Source-grounded only** — names/events/quotes must come from a curated lore
  corpus (DB tables below). The model never invents a real person.
- **Cameos can be present and react in narration.** Direct dialogue attributed
  to a named real person MUST be framed as overheard / "allegedly" / clearly
  satirical exaggeration. Never assert factual claims about them.
- **One named cameo per episode max.**
- The share card carries a one-line satire disclaimer.

`CLAUDE.md` and `src/lib/prompts/arc.ts` SYSTEM_RULES will be updated as part
of the implementation.

---

## 2. Data corpus

Three new datasets, all backed by Neon (`@neondatabase/serverless` already
wired in `src/lib/db.ts`).

### 2.1 `sf_events` — scraped weekly

| column | type | notes |
|---|---|---|
| `id` | text PK | stable slug from source (e.g. `lu-ma-2026-04-29-agi-house-demo`) |
| `name` | text | "AGI House Demo Night" |
| `venue` | text | "AGI House Hillsborough" |
| `start_at` | timestamptz | parsed from source |
| `host` | text | "AGI House" |
| `url` | text | source URL |
| `blurb` | text | 1-2 sentence vibe (LLM-summarized from scraped description) |
| `known_attendees` | text[] | `sf_people.id` foreign IDs (denormalized for speed) |
| `tags` | text[] | `ai`, `hype`, `partying`, `fundraising`, etc. — same vocabulary as `FLAVOR_TAGS` |
| `scraped_at` | timestamptz | for freshness pruning |

**Sources**:
- `lu.ma/sf-tech-week`, `lu.ma/sf` (public HTML, no auth)
- `partiful.com` public event pages
- `cerebralvalley.ai` calendar
- AGI House calendar
- Hand-paste fallback for the screenshots in `references/silicon-mania/`

### 2.2 `sf_people` — hand-curated, ~50 rows

| column | type | notes |
|---|---|---|
| `id` | text PK | slug, e.g. `sam-altman` |
| `display_name` | text | "Sam Altman" |
| `role` | text | one of `vc \| cofounder \| reporter \| hater \| mentor` |
| `vibe` | text | one-line voice/persona ("two-word sentences, scrolls X mid-meeting") |
| `regular_spots` | text[] | venue IDs they're commonly seen at |
| `x_handle` | text nullable | "@sama" |
| `encounter_styles` | text[] | `benediction`, `cryptic-DM`, `ghost-follow`, `public-roast`, etc. |
| `tags` | text[] | for affinity scoring |
| `achievement_hook` | text nullable | maps to a CLAUDE.md achievement (e.g. `altmanned`) |

Editing flow: PR-edit `src/lib/lore/people-seed.json` → `npm run seed:people`
upserts into Neon. Source of truth is the JSON file in repo, not the DB row.

### 2.3 `sf_stories` — scraped weekly

| column | type | notes |
|---|---|---|
| `id` | text PK | source-prefixed slug (`hn-2026-04-22-pivot-week-2`) |
| `beat` | text | one-sentence retelling, ≤220 chars |
| `tone` | text | `cynical \| earnest \| hype \| absurd \| wistful` |
| `source_url` | text | original |
| `applicable_archetypes` | text[] | which archetypes this story works for |
| `tags` | text[] | for affinity scoring |
| `scraped_at` | timestamptz | for freshness pruning |

**Sources** (no Twitter — explicitly skipped, cost):
- HN Algolia API (`hn.algolia.com/api/v1/search`)
- Reddit JSON endpoints (r/startups, r/SanFrancisco, r/ycombinator, r/VentureCapital)
- Substack RSS (Pirate Wires, Newcomer, Big Technology, Lenny's, The Generalist, Stratechery)

Stories are LLM-summarized down to the `beat` field at scrape time so the
picker prompt stays terse.

### 2.4 What stays from the existing lore

- `src/lib/lore/places.json` — keep, still useful for color in scenes that
  aren't tied to a live event.
- `src/lib/lore/running-jokes.json` — keep, used as tonal seasoning.
- `src/lib/lore/zeitgeist.json` — keep, still feeds time-bounded vibes.
- `src/lib/lore/cameos.json` — **delete**. Replaced by `sf_people`.

---

## 3. The picker — three stages

Two-stage hybrid: deterministic candidate filter → LLM judgment → server
validation. Replaces the `formatLoreBundle` dump in `src/lib/prompts/arc.ts`.

```
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 0 — Corpus loaders (Neon read, milliseconds)                  │
│  liveEvents = sf_events where start_at ∈ [now, now+7d]               │
│  peoplePool = sf_people (all rows)                                   │
│  storyPool  = sf_stories where scraped_at >= now-14d                 │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 1 — Deterministic candidate filter (pure TS, ~1ms)            │
│  Inputs : flavorTags, stats, alreadyEncountered, seed (playthroughId)│
│  Outputs: ≤8 events, ≤12 people, ≤10 stories                         │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 2 — LLM picker (Haiku, ~400ms, ~2k in / ~200 out)             │
│  Sees   : candidates + player state + storySoFar + alreadyEncountered│
│  Returns: { eventIds:[1-2], peopleIds:[0-1], storyIds:[1-2],         │
│             rationale }                                              │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 3 — Server-side validation                                    │
│  Drop hallucinated IDs, enforce caps, hydrate IDs → full lore objects│
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                     /api/generate-arc (Sonnet, current)
```

### 3.1 Stage 1 scoring (pure functions, unit-testable)

```ts
// Events
score(event) = 3 * intersect(event.tags, flavorTags).length
             + recencyBoost(event.start_at)        // 0..2, peaks at "tonight"
             + 0.5 * mulberry32(seed + event.id)

// People
candidates = unique([
  ...candidateEvents.flatMap(e => e.known_attendees),
  ...sampleN(WILDCARDS, 3, seed)         // famous names not tied to a venue
])
exclude alreadyEncountered

// Stories
score(story) = intersect(story.tags, flavorTags).length
             + (story.tone === lastEpisodeTone ? -1 : +1)
             + 0.3 * mulberry32(seed + story.id)
```

Hard stat-bias rules live here (deterministic, not LLM-fuzzed):

```ts
if (stats.hype >= 4 && peoplePool.find(p => p.id === 'sam-altman')) {
  candidates.push({ ...sam, scoreBoost: +5 })  // achievement bias
}
```

Mulberry32 seed function is already in `src/lib/lore.ts`.

### 3.2 Stage 2 prompt structure

System block (cached):
> You are the lore-curator for "Road to SF". You receive a candidate pool of
> real SF events, real people, and scraped anecdotes, and you pick the
> tightest set for ONE 5-scene episode. You return JSON IDs only — never
> invent names, never write content. Pick 1-2 events, 0-1 named cameo, 1-2
> stories. The cameo must plausibly be at one of the picked events (matched
> via known_attendees or regular_spots overlap with the venue). Bias toward
> picks that exploit the most recent player choice and the current stat
> trajectory. Avoid picks listed under ALREADY ENCOUNTERED.

User block:
- `## PLAYER STATE` — stats, persona, episode index, last hook
- `## STORY SO FAR` — `arc.storySoFar`
- `## ALREADY ENCOUNTERED` — IDs from `arc.loreHistory`
- `## CANDIDATE EVENTS / PEOPLE / STORIES` — Stage 1 output, one line each
- Output: `{ "eventIds": [...], "peopleIds": [...], "storyIds": [...], "rationale": "<≤120 chars>" }`

### 3.3 Stage 3 server validation

```ts
picks.eventIds = picks.eventIds.slice(0, 2)
picks.peopleIds = picks.peopleIds.slice(0, 1)
picks.storyIds = picks.storyIds.slice(0, 2)
picks.eventIds = picks.eventIds.filter(id => candidateEventIds.has(id))
// ...same for people, stories
```

Hydrate IDs → full rows for the arc-gen prompt.

### 3.4 Failure handling

- **Picker LLM throws** → fall back to Stage 1's top-1 picks per dataset. Story
  still works, just less curated.
- **Empty corpus** (between SF Tech Weeks, no live events) → arc skeleton
  generates without an event hook. Existing `places.json` color carries it.
- **Hallucinated IDs** → server validation drops them silently, logs warning.

---

## 4. Integration with existing arc flow

### 4.1 New types (`src/lib/types.ts`)

```ts
interface ArcEpisodeLore {
  episodeIndex: number
  eventIds: string[]
  peopleIds: string[]
  storyIds: string[]
  pickedAt: string  // ISO
  rationale: string // for debugging/logs
}

interface StoryArc {
  // ...existing fields
  loreHistory: ArcEpisodeLore[]   // append per episode
}
```

### 4.2 New / changed routes

- `POST /api/pick-lore` (NEW) — body: `{ episodeIndex, flavorTags, stats,
  storySoFar, alreadyEncountered, seed }`. Returns hydrated picks.
- `POST /api/generate-arc` (EDIT) — accepts new `loreSelection` field carrying
  hydrated picks. The current `formatLoreBundle` shrinks — no more big lore
  dump, just the static rules.
- `GET /api/cron/scrape-events` (NEW) — Vercel Cron, daily.
- `GET /api/cron/scrape-stories` (NEW) — Vercel Cron, daily.

### 4.3 Client orchestration (`src/app/page.tsx`)

`buildArcRequestBody` becomes a two-step:

```ts
async function generateEpisode(episodeIndex: number) {
  const picks = await postWithTimeout('/api/pick-lore', {
    episodeIndex,
    flavorTags, stats, storySoFar, alreadyEncountered, seed: playthroughId,
  })
  // Persist picks before arc-gen so per-scene calls can read them even if
  // arc-gen falls back.
  arcLoreReady(picks)
  const skeleton = await postWithTimeout('/api/generate-arc', {
    ...buildArcRequestBody(episodeIndex),
    loreSelection: picks,
  })
  arcSkeletonReady(skeleton)
}
```

Per-scene calls (`/api/generate-scene`) also receive `loreSelection` so each
scene knows which event/person it's hinging on.

### 4.4 Prompt changes (`src/lib/prompts/arc.ts`)

- Drop the "Real people are NEVER named" line from `SYSTEM_RULES`.
- Add the new naming/cameo policy lines (see §1).
- Replace the cached `formatLoreBundle` body with a slim version: just the
  static character roster + the assigned archetype-per-scene order. Drop the
  full lore filter dump.
- Add a `## LORE PICKS FOR THIS EPISODE` section in the user block, populated
  from `loreSelection`:
  ```
  Live events:
  - Tue 8pm · AGI House Demo Night · Hillsborough · "Open bar, 12 demos..."
    Cameos available: Sam Altman, Andrej Karpathy.
  
  Cameo budget for this episode: 1 named person.
  - Sam Altman — Sam-coded oracle, regular at AGI House. Encounter modes:
    cryptic-DM, ghost-follow, benediction.
  
  Tonal seeds (DO NOT copy verbatim — match energy):
  - "YC W26 founder pivoted from AI sales to AI dating, closed in 9 days"
  
  Already encountered (do NOT re-introduce; reference as continuity):
  - (none)
  ```

### 4.5 Token math

| | Before | After |
|---|---|---|
| Cached system block | ~1.4k (lore bundle) | ~0.6k (rules + cameo policy) |
| User block | ~0.6k | ~0.9k (incl. picks) |
| **Per arc call** | ~2k | ~1.5k |

Picker call: ~2k in / ~200 out, ~$0.0005 / 400ms on Haiku. Net: arc-call gets
sharper AND smaller.

---

## 5. File layout (final)

```
migrations/0004_lore.sql                       NEW
scripts/seed-people.mjs                        NEW
scripts/scrape-events.mjs                      NEW
scripts/scrape-stories.mjs                     NEW
src/lib/lore/people-seed.json                  NEW (~50 rows, hand-curated)
src/lib/lore/candidates.ts                     NEW (Stage 1 pure-TS scoring)
src/lib/lore/lore-db.ts                        NEW (Stage 0 SQL helpers)
src/lib/prompts/picker.ts                      NEW
src/lib/schemas/picker.ts                      NEW (Zod for picker output)
src/app/api/pick-lore/route.ts                 NEW
src/app/api/cron/scrape-events/route.ts        NEW
src/app/api/cron/scrape-stories/route.ts       NEW
src/app/api/generate-arc/route.ts              EDIT — accept loreSelection
src/lib/prompts/arc.ts                         EDIT — slim bundle, add picks section
src/lib/prompts/scene.ts                       EDIT — accept loreSelection
src/app/api/generate-scene/route.ts            EDIT — pass loreSelection through
src/lib/types.ts                               EDIT — ArcEpisodeLore, loreHistory
src/lib/session.ts                             EDIT — store picks in arc.loreHistory
src/app/page.tsx                               EDIT — call /api/pick-lore first
src/lib/lore/cameos.json                       DELETE (replaced by sf_people)
CLAUDE.md                                      EDIT — drop "no real names" rule
vercel.json                                    NEW — cron schedule
```

---

## 6. Phased rollout

Each phase is independently shippable and verifiable.

### Phase 1 — Data layer (half day)
- `migrations/0004_lore.sql` + apply via existing `npm run db:migrate`.
- `src/lib/lore/people-seed.json` hand-curated (~50 SF figures: founders, VCs, journalists, operators).
- `scripts/seed-people.mjs` upserts seed → `sf_people`.
- `scripts/scrape-stories.mjs` (HN + Reddit + Substack RSS), inserts to `sf_stories`. LLM-summarizes each into ≤220-char `beat`.
- `scripts/scrape-events.mjs` (Luma + Partiful + cerebralvalley). For now, also accepts a `--from-screenshots references/silicon-mania/*.png` flag that uses Claude vision to extract events from the existing screenshots.

**Verification**: `psql` queries return rows. No app changes yet.

### Phase 2 — Candidates module (quarter day)
- `src/lib/lore/candidates.ts` — pure-TS Stage 1 scoring, no LLM.
- Unit tests covering: tag overlap scoring, recency boost, exclusion via `alreadyEncountered`, stat-bias for `sam-altman` at `hype ≥ 4`, mulberry32 seed determinism.

**Verification**: `npm test` (need to add Vitest if not present).

### Phase 3 — Picker route (half day)
- `src/app/api/pick-lore/route.ts` wires Stages 0 → 1 → 2 → 3.
- `src/lib/prompts/picker.ts` builds the picker prompt.
- `src/lib/schemas/picker.ts` Zod gate + ID validation.
- Fallback to deterministic-only picks if Haiku throws.

**Verification**: curl the endpoint with sample bodies, confirm picks are
plausible and stable per seed.

### Phase 4 — Arc integration (half day)
- Update `src/lib/types.ts` (`ArcEpisodeLore`, `loreHistory`).
- Update `src/lib/session.ts` (`arcLoreReady` reducer, append to
  `loreHistory`).
- Update `src/lib/prompts/arc.ts` (drop bundle, add picks section, drop "no
  real names" rule).
- Update `src/app/api/generate-arc/route.ts` (accept `loreSelection`).
- Update `src/lib/prompts/scene.ts` + `src/app/api/generate-scene/route.ts`
  (per-scene calls reference picks).
- Update `src/app/page.tsx` to call `/api/pick-lore` before
  `/api/generate-arc`.
- Update `CLAUDE.md` (decision log: real names allowed).

**Verification**: full playthrough end-to-end. Inspect generated episodes for
named cameos and event hooks. Run `scripts/inspect-last-run.mjs`.

### Phase 5 — Cron + deploy (quarter day)
- `vercel.json` cron config.
- `CRON_SECRET` env var on Vercel.
- Cron route handlers wrap Phase 1 scrapers, gated on the secret.
- Deploy preview, verify a cron run, then promote.

### Phase 6 — Polish (optional, post-MVP)
- Achievement triggers wired: `arc.loreHistory` walked at run-end, cameo IDs
  unlock matching achievement IDs.
- Source attribution on share card (linkable "based on a real thread").
- Satire disclaimer on share card.

---

## 7. Open questions / risks to revisit

- **Legal**: real names = right-of-publicity exposure. Mitigation = framing
  rules + disclaimer. Acceptable per Apr 29 design call.
- **People seed staleness**: hand-curated, but SF roster shifts quarterly.
  Need a "refresh checklist" cadence — quarterly review.
- **Token bloat over time**: `sf_stories` rows accumulate. Stage 0 prunes via
  `scraped_at >= now-14d`. Watch for picker-input bloat once we have >100
  story candidates per call.
- **Scrape brittleness**: Luma/Partiful HTML changes break scrapers. Each
  scraper logs to a `scrape_runs` table (TODO) so we can monitor failures
  before they silently empty the corpus.
- **Cameo parade**: per-episode cap is 1, per-run cap is implicit via
  `alreadyEncountered`. Watch playthrough QA — if every run hits the same 5
  names, increase wildcard pool.
- **Twitter is out**. Some great anecdotes will be missed. Revisit if a free
  source emerges or Apify ($30/mo) gets approved.

---

## 8. What I need from you to start coding

1. **A real DB connection**: `DATABASE_URL` for the worktree's `.env.local`
   (can be the same Neon DB or a separate dev branch).
2. **Source URL list for events**: confirm Luma + Partiful + cerebralvalley is
   the right starter set, or add others.
3. **Approve the people seed list** once I draft it (~50 names) before running
   `seed-people.mjs` against the DB.
4. **Vercel `CRON_SECRET`** added to project env (only needed at Phase 5).
