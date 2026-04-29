# Road to SF — Business Context

Pricing model, cost structure, and unit economics for the game. Read alongside `BRIEF.md`, `GAME_LOGIC.md`, and `GROUP_ARCHITECTURE.md`.

---

> **April 2026 update — per-scene metering, episode-guaranteed SKUs.**
> The runtime bills **per scene**: 1 credit debits on the first beat
> of each LLM scene; subsequent beats inside the same scene are free.
> Episodes are 3–5 scenes; `/api/generate-episode` refuses to start an
> episode unless the balance is at least `EPISODE_FLOOR` (5). That
> guarantees the player never gets paywalled mid-narrative — the wall
> fires only between episodes.
>
> Customer-facing SKU is **episodes**: $5 = 1 guaranteed full episode,
> $15 = 4 guaranteed full episodes. Internally credits remain the
> unit of metering and surface in the UI as "scenes left" (a counter
> the player watches tick down per scene). The per-playthrough COGS
> table below still works as a sanity bound; re-derive once
> `usage_log` has 100+ real episodes.

---

## TL;DR

- **Marginal cost: ~$0.12 per scene** (Sonnet 4.6 + ElevenLabs Creator + Flux Dev, archetype portraits pre-cached). A 5-scene episode lands ~$0.60.
- **Primary SKU: $5 = 1 guaranteed full episode.** 6 scenes credited; 1 floats as a buffer the player can't spend solo (worst-case episode is 5).
- **Upsell SKU: $15 = 4 guaranteed full episodes.** 20 scenes credited; offered to players who finish episode 1.
- **BYO API key tier: free.** Power users cost nothing and convert into evangelists.
- **TTS is 60% of variable cost.** Every char of dialogue trimmed compounds margin.
- **Paywall fires only between episodes.** The episode-start floor check (`EPISODE_FLOOR=5`) makes the share-card payoff reachable on every paid run.

---

## Definitions

- **Scene** = the metered unit. One LLM-generated scene container holding 1+ beats. The credit debit fires on the scene's first beat; replays inside the same scene cost nothing.
- **Episode** = 3–5 scenes that share a setting + cast roster. The customer-facing SKU. `EPISODE_FLOOR=5` is the worst-case scene count we provision against.
- **Playthrough** = the player's session — onboarding intro + N episodes worth of credits, ending on the share card. Episodes per playthrough = `floor(credits / 5)` (with leftovers stranded so an episode-2 paywall never strands mid-narrative).
- Replay incentive = unlock the 12 hidden achievements; players need several full playthroughs to collect most of them.

---

## Cost per playthrough

Based on the game flow in `CLAUDE.md`: 1 arc + 5 scenes + 1 epilogue, voiced dialogue per scene, scene background images.

| Item | Volume | Cost |
|---|---|---|
| LLM input (Sonnet 4.6, ~70% cache hit on arc + lore) | ~17.5k tokens, mixed | $0.02 |
| LLM output | ~5.7k tokens | $0.09 |
| Cache write overhead (one-time per playthrough) | ~5k tokens × 1.25× | $0.02 |
| ElevenLabs TTS (~2k chars dialogue across 5 scenes) | 2,000 chars | $0.36 |
| Flux Dev images (5 scene backgrounds; portraits cached at archetype level) | 5 × $0.025 | $0.13 |
| Vercel + Neon | per-play amortized | <$0.01 |
| **Marginal cost per playthrough** | | **~$0.62** |

**Sensitivity:**
- Switch arc + scenes to Haiku 4.5 → drops to ~$0.55/play.
- Cut TTS entirely → drops to ~$0.25/play.
- Drop scene images, reuse 5 archetype backgrounds → drops to ~$0.50/play.

---

## API pricing reference (April 2026)

| Provider | What | Rate |
|---|---|---|
| Anthropic | Sonnet 4.6 | $3 input / $15 output per MTok |
| Anthropic | Haiku 4.5 | $1 / $5 per MTok |
| Anthropic | Opus 4.7 | $5 / $25 per MTok |
| Anthropic | Cache read | 0.1× base input (90% off) |
| ElevenLabs | Creator tier | $11/mo for 121k chars → ~$0.18 per 1k chars |
| Fal | Flux Dev image | $0.025 per image at 1024×1024 |
| Stripe US | Per charge | 2.9% + $0.30 (Embedded Checkout free) |

Note: Opus 4.7 uses a new tokenizer that consumes up to 35% more tokens for the same text.

Sources:
- [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [ElevenLabs pricing](https://elevenlabs.io/pricing)
- [Fal Flux Dev pricing](https://fal.ai/models/fal-ai/flux/dev)
- [Stripe US fees](https://stripe.com/us/pricing)

---

## Pricing math (net of Stripe + COGS at $0.62/play)

| Sticker | Plays | COGS | Stripe fee | Net profit | Net per play |
|---|---|---|---|---|---|
| $1 | 1 | $0.62 | $0.33 | $0.05 ⚠️ unprofitable | $0.05 |
| $3 | 1 | $0.62 | $0.39 | $1.99 | $1.99 |
| **$5** | **3** | **$1.86** | **$0.45** | **$2.69** | **$0.90** |
| $8 | 3 | $1.86 | $0.53 | $5.61 | $1.87 |
| $9 | 3 | $1.86 | $0.56 | $6.58 | $2.19 |
| **$15** | **10** | **$6.20** | **$0.74** | **$8.06** | **$0.81** |
| $19 | 8 | $4.96 | $0.85 | $13.19 | $1.65 |
| $25 | 12 | $7.44 | $1.03 | $16.53 | $1.38 |

Don't price below $3 — Stripe's $0.30 fixed fee crushes single-dollar transactions.

---

## Recommended pricing — UX-optimized

Two SKUs only. Choice paralysis at the paywall kills conversion harder than wrong pricing does. Every SKU = a whole number of guaranteed episodes; never strand a player mid-narrative.

| SKU | Price | Episodes | Scenes credited | When shown |
|---|---|---|---|---|
| **One-Way Ticket** | $5 | 1 | 6 | Default for first-time visitors |
| **Founder Pass** | $15 | 4 | 20 | Upsell, shown after the first episode is used |
| **BYO API Key** | Free | Unlimited | n/a | Power-user opt-in, framed in-world as "bringing your own capital" |

**Why this shape:**
- 1 full episode for $5 is enough that a bad first run reaches its share card — the only marketing channel that matters for a virality product.
- $5 is the impulse-buy threshold; higher tanks conversion.
- Founder Pass at $15 = 4 episodes is the achievement-hunter SKU. 12 hidden achievements means committed players want multiple full episodes; showing it after episode 1 means it's offered to people who've already felt the pull.
- BYO key keeps technical users on the platform without cannibalizing paid revenue (most users won't have an API key).
- Customer never sees the word "credit." The UI counter says "scenes left." Internal/external mental models stay one layer.

**Tradeoff:** simpler pricing leaves money on the table from the "would have paid $9 for 1 episode" segment. For a virality product, that's the right tradeoff — conversion > ARPU because each shared ending is also a marketing impression.

---

## Strategic principles

1. **This is a virality product, not a SaaS.** Optimize share rate, not LTV. Each $5 ticket also functions as a marketing impression when the share card hits social.
2. **Achievements are the replay engine.** No explicit replay mode needed; the 12 hidden achievements pull players back naturally.
3. **No subscription.** Wrong shape for a 10-15 minute novelty product; subscriptions imply ongoing value and would churn instantly.
4. **Non-refundable, that's the joke.** Add this disclaimer at checkout — pre-empts refund requests on boring runs and stays in tone.

---

## Cost levers (in order of impact)

1. **TTS dialogue length** — 60% of marginal cost. Hard-cap NPC dialogue per scene (e.g., max 350 chars). Every char compounds.
2. **Image generation scope** — pre-generate 5 archetype portraits *once*, not per-playthrough. Only scene backgrounds need per-play generation, and those can be cached by scene-archetype combination too.
3. **Model choice** — Sonnet 4.6 for arc generation (quality matters), Haiku 4.5 for per-scene generation (structured outputs, simpler).
4. **Prompt caching** — cache the lore bundle + arc + system prompt across all 5 scene calls. Cuts ~70% of input tokens to 0.1× rate.

---

## What to instrument before re-pricing

Log to Neon per `playthrough_id`:
- Total input tokens, output tokens, cached tokens (per LLM call)
- Total TTS characters generated
- Image generation count
- ElevenLabs voice ID used
- Total wall-clock time

After ~100 real playthroughs, recompute marginal cost from actuals and re-price. The estimates above are back-of-envelope; the only number that matters is what shows up on the bills.

---

## Open questions

- **Voice quality vs. cost** — does the magic require ElevenLabs' top-tier voices, or is the Turbo model good enough? A/B test before committing to Creator tier.
- **Single-scene replay SKU** — should "$1 to retry this scene" be offered? Could improve UX (don't waste a full ticket on one bad choice) but adds payment friction mid-game. Skip until there's data showing scene-level frustration.
- **Free first play** — does giving the first playthrough away (cost: $0.62) drive enough conversion to a paid pack to justify the CAC? Worth testing once base traffic exists.
- **Stripe processing on bundles** — if the 10-pack converts at a higher rate after the first 3 plays, the implicit CAC of the One-Way Ticket is its full COGS minus the 10-pack net. Track this funnel.
