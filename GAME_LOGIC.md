# roadtosf — Game Logic Design

Companion to `BRIEF.md`. The BRIEF locks scope and structure; this doc locks the mechanics of how choices become endings, and why each rule exists. Read both before implementing.

## Core model — Sorting Hat, not a tube

Fixed 5-scene sequence. Choices do NOT change which scene comes next. Choices move two hidden axes; the final vector is mapped (Sorting Hat-style) to one of 5 endings. Scene dialogue and character tone shift with the current vector — the *path* doesn't branch, but the *feel* of each scene does.

Reference: Sam Kabo Ashwell's "Standard Patterns in Choice-Based Games." The canonical short-form example is Reigns.

## The two axes

| Axis | Range | Low | High |
|---|---|---|---|
| **Hype** | −5 to +5 | nobody | legend |
| **Integrity** | −5 to +5 | sellout | principled |

Loyalty is NOT an axis. It's a **scene-level modifier** — if the player betrays the co-founder in scene 3, the co-founder is cold in scene 4. Doesn't affect the ending vector.

## Ending map (by quadrant)

```
                     HYPE (+)
                        |
      INDICTED  ────────┼────────  IPO
                        |
   SELLOUT ─────────  GHOSTED  ───────── PRINCIPLED
     (−)                |                   (+)
                        |
    ACQUI-HIRE  ────────┼────────  AI-WRAPPER PIVOT
                        |
                     HYPE (−)
```

- **High hype, high integrity → IPO**
- **High hype, low integrity → INDICTED**
- **Low hype, high integrity → AI-WRAPPER PIVOT** (honest retreat)
- **Low hype, low integrity → ACQUI-HIRE** (sold for parts)
- **Center (|hype| + |integrity| < threshold) → GHOSTED** (never registered)

## Stat rules

- Every binary choice: ±1 on hype, ±1 on integrity. Most choices move both.
- Starting vector: (0, 0) for every player. Player input does NOT shift starting stats.
- Deltas are authored per-choice, not LLM-decided. Keep them in a static table tied to choice IDs.
- Final vector classified into quadrant using integer thresholds; ghosted is the fallback center region.

## Scene anatomy (every scene follows this)

1. **Cold-open callback** — one line referencing the previous choice, delivered by the scene's primary character. This is the authorship illusion (Reigns insight). LLM-generated with choice history as context.
2. **Setup dialogue** — 3–5 voiced lines establishing the dilemma.
3. **Demand** — the character makes a specific ask.
4. **Choice window** — 15s timer, 3 outcomes (A, B, or world-decides-on-timeout).
5. **Reaction beat** — one in-character line acknowledging what the player did (no meta "X will remember that").
6. **Stat delta applied silently** → transition card.

Choice labels are **authored** (≤8 words, fixed per scene). Only dialogue is LLM-generated. Never generate button labels at runtime — latency and reliability disaster.

## Timer mechanic

**15 seconds.** Timer starts when audio playback begins, not when the TTS API call starts.

On timeout, a **distinct third outcome fires**, not a silent default. The world makes the decision for the player and acknowledges it:

> *[Founder stared at their phone. The VC took that as a yes.]*

Why: mechanic = theme (SF doesn't wait); better comedy beat than a silent default; absorbs passive players into the natural center of the ending map (ghosted) without punishing them arbitrarily.

## Callback rule (authorship illusion)

Scenes 2–5 must open with one line referencing the previous choice. This is the single most important authored-feel mechanic. The Reigns insight: *once the player notices one card remembers, every card feels authored*.

Implementation: per-scene LLM call takes `{previousChoice, currentScene}` and returns the cold-open line. 50–100 tokens. Must stay in character.

## Personalization rule

Player input does exactly two things:

1. **Noun-slot substitution.** Startup name/idea injected into authored templates — VC's objection, reporter's angle, hater's tweet.
2. **Narration register.** Self-description picks tone for internal narration (Disco Elysium-style). First-time technical founder = anxious register. Third-time exit founder = cynical register.

Player input does NOT move stats, does NOT gate branches. This prevents the "did my typing change the ending?" ambiguity that kills the "I earned this" feeling.

## Three additions beyond baseline (the 85% → 95% gap)

### 1. Tonal shift by quadrant
Each scene's LLM prompt includes a style-flag derived from the current vector. Not stats shown to the player — tone shifts in how the world treats them.
- High hype: characters compliment, defer, use "sir."
- Low integrity: small cuts from NPCs get bigger. The hater's posts escalate.
- Low hype: characters interrupt more, look at their phones mid-sentence.

Implementation: one flag in the system prompt per scene. Cheap.

### 2. Ending epilogue paragraph
The ending label ("INDICTED") is the hook. The shareable thing is a 2–3 sentence epilogue naming specific choices:

> *The SEC opened an inquiry in November. You're on your third podcast apology tour. Wagr pivoted to compliance software and still has 12 employees.*

One extra LLM call at the end, ~80 tokens, references choice history. This is the single biggest cheap upgrade.

### 3. One wildcard scene with free-text response
Scene 3 (the VC) gets a free-text counter-offer in addition to the two binary choices:

> [Take the money] [Walk] [Counter-offer → text input]

The LLM reads the counter-offer and classifies it into one of the two binary outcomes (or a third "impressed the VC" path that nudges both hype and integrity up). Breaks the "5 binaries in a row" monotony *once*, at the biggest-feel decision. Doesn't scale to other scenes.

## Scene-by-scene beat template

| # | Scene | Primary character | Demand | Binary choices (labels, ≤8 words) |
|---|---|---|---|---|
| 1 | The Pivot | Co-founder | back pivot or override | "No, ship the original" / "Yes, pivot" |
| 2 | The Scoop | Reporter | leak or protect | "That's not true" / "Send her the details" |
| 3 | The Term Sheet | VC | take, walk, or counter | "Take it" / "Walk" / *+ counter-offer text input* |
| 4 | Trust Crisis | Co-founder (+ hater in bg) | confront, lie, or exploit | "Lie" / "Level with them" |
| 5 | Demo Day | Mentor (pre-stage) | safe or full hype | "Understated truth" / "Full hype" |

Character debut rule: every character's primary scene must (a) make a specific demand, (b) reveal a flaw on-screen, (c) deliver one screenshot-worthy line. The VC's line is locked: the actual Thiel question — *"Tell me something that's true that almost nobody agrees with you on."*

## Worked example (Wagr playthrough)

Input: *Wagr — Venmo for sports bets between friends*. Ex-Stripe first-time founder.

- Scene 1, pivot to AI agent. hype +1, integrity −1. Vector (1, −1).
- Scene 2, times out on the Stripe-leak dilemma. *"She filled the silence."* hype +1, integrity −1. Vector (2, −2).
- Scene 3, takes Thiel's term sheet with co-founder-removal clause. hype +1, integrity −1. Vector (3, −3). Loyalty modifier fires.
- Scene 4, lies to co-founder. integrity −1. Vector (3, −4).
- Scene 5, full hype on stage ("$10M ARR by year-end" vs actual $80K MRR). hype +2, integrity −1. Vector (5, −5).

Quadrant: high hype + low integrity → **INDICTED.**

Epilogue:
> *You took Thiel's term sheet, let TechCrunch run with the Stripe rumor, lied to your co-founder, and promised $10M ARR on stage with $80K MRR. The SEC called Monday.*

## Share card anatomy (build this day 1)

- Startup name, huge, top.
- Ending label + personalized hero image.
- Epilogue paragraph naming 2–3 specific choices.
- One stat for virality ("Only 12% of founders get indicted").
- Prefilled X/LinkedIn share text. **Never make the player write the caption.**

Screenshot-optimized layout. Square aspect for social. Use `dom-to-image-more` or `html2canvas` — do NOT rely on fal.ai URLs in the share link (they expire ~1hr).

## Satire rule (load-bearing)

Satirize the *systems*, *jargon*, and *class behaviors* — never the player's actual startup idea. If they input something dumb, the VC takes it *seriously*, with Goldman Sachs gravitas. Taking bad ideas seriously IS the joke. Player-founder = Richard Hendricks. The world around them = satire target.

LLM will fight this — it defaults to polite, hedging, affirming. Explicit style prompt: *"HBO Silicon Valley / Succession register. No corporate-speak, no hedging, no affirmations."*

## What NOT to build

- Every-scene multi-choice (scope trap, doubles authoring).
- Visible stat bars (Mass Effect proved this kills role-play).
- Alternate-antagonist replay mode (you're not optimizing for replay — this is Spotify Wrapped, not Reigns).
- "X will remember that"-style meta flags (use in-character callbacks instead).
- Runtime-generated choice labels (latency + reliability disaster).
- Starting stats derived from player input (destroys "I earned this" feeling).

## Implementation order (maps to BRIEF day plan)

- Day 1: scaffold + spikes + **static share-card prototype**. If the card can't be screenshotted by end of day 2, the project has no virality.
- Day 2: authored scene templates + one LLM call chain (story skeleton + scene 1 cold-open). Prove callback mechanic works on 3 different inputs.
- Day 3: all 5 scenes, stat ledger, quadrant classifier, timeout-as-third-outcome.
- Day 4: tonal shift flag, epilogue LLM call, free-text counter-offer for scene 3.
- Day 5: tune satire prompts, lock voices, write fallback arc for LLM failure.
- Day 6: 3 real founders playtest, demo video, ship.

## References

Key sources behind these decisions:
- Ashwell — Standard Patterns in Choice-Based Games (Sorting Hat)
- Reigns GameDeveloper deep-dive (authorship illusion via callbacks)
- Oxenfree GDC talk (conversation-flow timers)
- Bandersnatch (10s timer, default-on-timeout — we rejected for 15s + third outcome)
- Disco Elysium (hidden stats as tonal flavor, not gated numbers)
- Mass Effect Paragon/Renegade (cautionary tale: visible stats kill role-play)
- Spotify Wrapped / Co-Star / BuzzFeed (reveal-layout virality mechanics)
- HBO's Silicon Valley (satire-the-system, not the player)
