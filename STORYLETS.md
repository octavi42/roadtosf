# Storylet Engine — Research & Design Notes

This doc captures the research that motivates the storylet engine refactor.
It is the design layer that PR #23 (cameo + tone rolls) is meant to compose
into. Read alongside `CLAUDE.md` and `BRIEF.md`.

---

## The problem the storylet engine solves

Today, every run feels structurally identical even with the cameo + tone
diversity layer. Three structural locks remain:

1. The first 8 scenes are authored — same for every player.
2. `prompts/arc.ts` hardcodes the archetype order: `vc → cofounder →
   reporter → hater → mentor`. Every episode, every run.
3. The cofounder beat is structurally mandatory: even when the player
   says "solo," the prompt reframes the slot ("an old friend pitching
   to join…") rather than dropping it.

The cameo + tone PR shifted *dialogue color*; it did not move *plot*.
Plot still lives in the fixed scaffold above.

---

## The architectural insight

> **The LLM should NOT pick plot beats. It should only render beats a
> deterministic selector hands it.**

Right now the arc-gen prompt lets Claude freely choose what happens
(subject to weak constraints). Failbetter, Reigns, and inkle all
separate two layers:

- **Plot engine** — deterministic, gates content by world-state
- **Prose engine** — renders the chosen content

We've been collapsing both into a single LLM call. The fix is a
storylet engine on top of the LLM.

---

## Storylet, simply

A storylet is a small "card" with three parts:

1. **`requires`** — a predicate over game state ("hype ≥ 2", "team is
   solo", "Thiel was rolled")
2. **`beat`** — a one-line plot template ("a Thiel-coded VC offers a 5x
   term sheet at Rosewood")
3. **`effects`** — what flips after the storylet fires (e.g.
   `tookVCMoney = true`)

Build a **bag of ~15 storylets**. Each scene, a deterministic selector:

1. Filters to eligible storylets (`requires` predicate is true)
2. Scores each by salience (tag-overlap with current state)
3. Picks one
4. Hands it to the LLM, which only writes prose / dialogue / choices

Two players with different stat trajectories see disjoint storylet
pools from the same source data.

---

## Pattern map (what the literature calls this)

The same architecture has a name in three different communities:

| Community | Name |
|---|---|
| Failbetter / IF | Quality-Based Narrative (QBN) |
| Academic IF | Storylets |
| Recent LLM research | Drama Manager + LLM Renderer / Director-Actor split |
| Game-dev practitioners | Planner-Renderer architecture |

The recent academic precedent that maps **1:1** to our plan:

**Drama Llama** (Kreminski et al., arXiv 2501.09099, 2025). A
non-LLM drama manager evaluates author-written triggers against
story-so-far; on match, injects the next pre-authored "stage direction"
into the LLM prose call. The LLM only renders within those rails.

Our `selectStorylet → render with Haiku` is the same shape.

Other relevant work:

- **Dramatron** (Mirowski et al., DeepMind 2022): hierarchical
  prompt-chain (logline → characters → plot beats → dialogue), each
  layer constraining the next.
- **CoDi** (AAAI/AIIDE): Director-Actor split — director picks goals,
  actor LLM renders.
- **StoryVerse** (FDG 2024): planner emits structured events, LLM
  renders one node at a time with minimal context.
- **Hidden Door** (production analog): authored cards + LLM prose
  rendering. Closest commercial implementation. Documented failure
  modes (see below).

---

## Endless mode — keeping the bag deep

With ~15 storylet templates, raw cycling burns through the bag in 3
episodes. Four mechanisms make endless mode feel inexhaustible:

1. **Cooldowns.** A fired storylet enters a suppression list for N
   episodes (≈ 2). Eligible again afterward, but world state has
   moved, so it renders differently.
2. **Tiered unlock gates.** Storylets are tagged by tier
   (`early | mid | late`). Late-tier storylets require stat extremes
   (`hype >= 5`, `firedCount >= 12`). The bag *grows* as you play —
   episode 1 sees ~6 eligible, episode 5 sees ~15+. Late-game
   storylets are automatically rare and feel earned.
3. **Cameo + tone permutations** (already shipped in PR #23). The same
   `vc_term_sheet` storylet rendered with Thiel + paranoid-thriller is
   a different beat than with Marc Andreessen + hype-pilled-comedy.
   **15 templates × 5 cameos × 5 tones ≈ 375 distinct surfaces** before
   you author anything new.
4. **Consequence injection** (deferred to a later PR). After every
   choice, push 1–2 *consequence storylets* into the bag with high
   weight. "Ghost cofounder at Tartine" inserts `tartine_revenge_post`,
   `cofounder_starts_competitor`. Endless mode then *compounds* — the
   longer you play, the more bespoke your bag becomes.

Practical floor: ~50 episodes (= 250 storylet picks) per user before
noticeable repetition. Beyond that, the natural upgrade is
**meta-storylets** — LLM specializes a generic template into a
specific instance at fire-time. Defer until data shows actual fatigue.

---

## Unique stories per user — divergence cascades

Five layers stack. Each layer's output is the next layer's input —
**small input differences compound exponentially.**

1. **Different rolled cameos** (PR #23). 3 of 15 = ~455 combinations.
   `altman_blessing` only enters the eligible pool if Altman rolled.
2. **Different tone** (PR #23). Some storylets gate on tone; the rest
   render in tone color.
3. **Different player facts.** Solo vs named cofounder branches
   `cofounder_*` storylets in or out. "Bootstrapping" disables
   `vc_term_sheet`.
4. **Different stat trajectory.** Choice deltas push hype/integrity
   into different quadrants → different `requires` fire → different
   storylets emerge.
5. **Salience-based picks.** Among eligible storylets, the selector
   picks the one whose tags overlap *most* with current state. Mid-runs
   get generic beats; extreme runs get bespoke ones.

Combinatorics by end of episode 1:

- Cameos: ~455 sets
- Tones: 5
- Solo / cofounder: 2
- Stat quadrant: 4
- First-episode pick: ~6 options
- → **~110,000 distinct shapes**, before consequence injection.

You'd need 100k+ players before two of them got the same run from the
same starting inputs.

---

## Failure modes to pre-empt

Documented in the production literature (Hidden Door review, Drama
Llama author study, AI Dungeon postmortems). Each maps to a specific
defense in our PR:

- **Choice-illusion bug** (Hidden Door). If the renderer doesn't see
  *which* option the player picked and its stat delta, prose floats
  free of the choice. **Defense:** always inject `priorChoice + delta
  + tonalFlag` into the render prompt.
- **Retroactive worldbuilding** (Hidden Door). LLM invents details
  that contradict prior beats. **Defense:** lock cameos + places at
  the arc step; pass them as a frozen "cast list" to every scene
  render. Forbid the LLM from naming new characters.
- **Cliché output** (Drama Llama, 3 of 6 author study). Rendered prose
  drifts toward generic. **Defense:** specificity. Splice flavor tags
  + the player's startup name into render context (we already do for
  the epilogue; extend to all scenes).
- **Forced-character drift** (Drama Llama). Over-pinning founder
  persona makes characters read as stuck NPCs. **Defense:** let the
  renderer shift register slightly per tone / storylet mood; don't
  re-paste the same persona block verbatim.

The negative example — **AI Dungeon** — failed because it bolted
retrieval (Memory, World Info, Author's Note) onto a pure-LLM
substrate. Retrieval can't substitute for an authored skeleton. Our
storylet engine **is** the skeleton AI Dungeon never had.

---

## Implementation plan (ranked, not yet shipped)

1. **PR #1: Storylet engine spine** — patterns #1 + #3 (eligibility
   gates + salience-weighted selection). Pure code refactor + 12–15
   authored storylet templates.
2. **PR #2: Consequence injection** — pattern #2 (Reigns-style choice
   spawns new storylets). Validated only after PR #1 is shipping.
3. **PR #3 (later, data-driven)**: Per-cameo reaction stacks (Hades),
   meta-storylets (LLM-specialized templates), only if player data
   shows fatigue at the surface count.

Architectural rule for every PR in this stack:

> The planner controls *what happens*; the LLM controls only *how it
> sounds*. Don't let those two responsibilities blur.

---

## Sources

- [Drama Llama (arXiv 2501.09099)](https://arxiv.org/html/2501.09099v1) — closest precedent
- [Dramatron (DeepMind 2022)](https://arxiv.org/pdf/2209.14958) — hierarchical prompt cascade
- [Hidden Door design review (Bicking, 2025)](https://ianbicking.org/blog/2025/08/hidden-door-design-review-llm-driven-game.html) — failure modes
- [CoDi: Director-Actor (AIIDE)](https://ojs.aaai.org/index.php/AIIDE/article/download/36811/38949/40888)
- [StoryVerse (FDG 2024)](https://dl.acm.org/doi/10.1145/3649921.3656987)
- [Beyond Branching — Emily Short](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/)
- [Reigns Deep Dive — Game Developer](https://www.gamedeveloper.com/design/game-design-deep-dive-creating-an-adaptive-narrative-in-i-reigns-i-)
- [Hades narrative — Greg Kasavin](https://www.gamedeveloper.com/design/roguelikes-and-narrative-design-with-i-hades-i-creative-director-greg-kasavin)
- [Bruno Dias — Building a QBN system](https://brunodias.dev/2017/05/30/an-ideal-qbn-system.html)
- [LLMs and Games survey (arXiv 2402.18659)](https://arxiv.org/html/2402.18659v4)
- [AI Dungeon Author's Note docs](https://help.aidungeon.com/faq/what-is-the-authors-note)
