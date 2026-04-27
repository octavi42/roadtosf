# Road to SF — Business Context

Pricing model, cost structure, and unit economics for the game. Read alongside `BRIEF.md`, `GAME_LOGIC.md`, and `GROUP_ARCHITECTURE.md`.

---

> **April 2026 update — credit-based metering.** The "1 play = 1 full
> playthrough" math below predates the group-based LLM tail
> (`GROUP_ARCHITECTURE.md`). The runtime now bills per-group: **1 credit = 1
> LLM-generated group of 4 sub-scenes** (one shared image, four Sonnet
> calls, four TTS lines, ≈$0.42 COGS/group). The pack values in
> `src/lib/packs.ts` are the source of truth (currently $5 → 6 credits, $15
> → 20 credits) and the playthrough-level math in §"Cost per playthrough"
> still works as a sanity bound, just with N variable rather than fixed.
> Re-derive after the first 100 real runs land in `usage_log` per
> §"What to instrument before re-pricing".

---

## TL;DR

- **Marginal cost: ~$0.62 per playthrough** (Sonnet 4.6 + ElevenLabs Creator + Flux Dev, with archetype portraits pre-cached).
- **Primary SKU: $5 for 3 plays.** Net ~$3 per pack after Stripe + COGS.
- **Upsell SKU: $15 for 10 plays.** Shown only after a player finishes their first 3.
- **BYO API key tier: free.** Power users cost nothing and convert into evangelists.
- **TTS is 60% of variable cost.** Every char of dialogue trimmed compounds margin.

---

## Definitions

- **Playthrough** = one complete game = 1 arc generation + 5 scenes + 1 epilogue + voiced dialogue + scene images. ~10-15 minutes of play.
- A "pack" of N plays = N independent playthroughs (different startup name, different NPCs, different ending each time).
- Replay incentive = unlock the 12 hidden achievements; players need ~6-12 playthroughs to collect most of them.

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

Two SKUs only. Choice paralysis at the paywall kills conversion harder than wrong pricing does.

| SKU | Price | Plays | When shown |
|---|---|---|---|
| **One-Way Ticket** | $5 | 3 | Default for first-time visitors |
| **Founder Pass** | $15 | 10 | Upsell, shown only after the first 3 plays are used |
| **BYO API Key** | Free | Unlimited | Power-user opt-in, framed in-world as "bringing your own capital" |

**Why this shape:**
- 3 plays is enough that a bad first run doesn't feel like a ripoff. Lower than that and refund pressure spikes.
- $5 is the impulse-buy threshold for a 30-45 minute experience. Higher than that and conversion drops.
- The 10-pack is for the achievement-hunters; 12 hidden achievements means committed players want ~10 plays. Showing it after the first 3 means it's offered to people who've already felt the pull.
- BYO key keeps technical users on the platform without cannibalizing paid revenue (most users won't have an API key).

**Tradeoff:** simpler pricing leaves money on the table from the "would have paid $9 for 3" segment. For a virality product, that's the right tradeoff — conversion > ARPU because each shared ending is also a marketing impression.

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
