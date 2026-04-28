import { ARCHETYPES } from '../archetypes'
import type { ArcSkeleton, SceneOutline } from '../types'
import { MAX_DIALOGUE_CHARS_PER_SCENE } from '../schemas/scene'
import type { ToneSpec } from '../cameos/types'

export interface PriorChoiceSummary {
  sceneId: number
  choiceLabel: string
  hypeDelta: number
  integrityDelta: number
}

export interface BuildScenePromptInput {
  episodeIndex: number
  llmIndexInEpisode: number // 0..EPISODE_LENGTH-1 (= 0..19), position within episode
  /** Which archetype group within the episode (0..GROUPS_PER_EPISODE-1). */
  groupIndex: number
  /** Position within the archetype group (0..SCENES_PER_GROUP-1). 0 opens. */
  subSceneIndex: number
  sceneId: number // 1-based id within the full playthrough
  outline: SceneOutline
  arcSkeleton: ArcSkeleton
  storySoFar?: string // rolling compressed summary across all prior episodes
  startupName: string
  startupDescription: string
  founderPersona: string
  stage?: string
  team?: string
  fundingModel?: string
  targetCustomer?: string
  concern?: string
  flavorTags: string[]
  recentChoices: PriorChoiceSummary[] // only the last few; older context lives in storySoFar
  currentStats: { hype: number; integrity: number }
  /** Per-run tone (rolled at run-start, stable across all scenes). */
  tone?: ToneSpec
}

const SCENE_SYSTEM_RULES = `You are the per-scene engine for "Road to SF", a satirical comic-book founder game running in ENDLESS MODE. You produce ONE scene at a time, given the current episode's arc skeleton, a rolling story-so-far summary, and the player's recent choices.

HARD RULES:
- Output a single JSON object only. No prose before or after, no markdown fences. Start your response with "{" and end with "}".
- Numbers must be valid JSON: write 1 not +1, write 2 not +2.
- Real people are NEVER named — archetype them.
- Use ONLY the archetype assigned in the outline as the in-scene speaker (other archetypes can be referenced in dialogue but not present).
- In JSON, "archetype" and NPC dialogue "speaker" MUST be the lowercase archetype KEY (vc|cofounder|reporter|hater|mentor) or player|narrator — NEVER a display string like "Stranger, Co-founder & CTO" or "Victor, Managing Partner…".
- Total dialogue across all lines in this scene MUST be ≤${MAX_DIALOGUE_CHARS_PER_SCENE} chars (TTS budget).
- Each individual dialogue line ≤160 chars and MUST contain non-empty text. Do not use empty strings for "silent beats" — express silence in narration prose, not as an empty player line.
- 2–4 dialogue lines per scene total.
- JSON STRING SAFETY (the most-broken rule, do not relax): inside any "text" field, NEVER use the " character. If you need to quote in-text speech, use single quotes (') or em-dashes. Bad: "text": "He said \\"sure\\" and walked off." Good: "text": "He said 'sure' and walked off." This is a hard parser-failure rule — every unescaped " breaks the scene and forces a fallback that interrupts audio.
- Each dialogue line is ONE speaker's utterance. Do NOT mix narration + quoted speech in a single "text" value. If the beat is "X says A, then Y reacts with B," split into TWO dialogue entries with different speakers — not a single line containing both. The renderer assigns voices per speaker; mixing them inside one line is voiced as one continuous read.
- Choice labels: 2–3 per scene, ≤8 words each, action-flavored.
- Stat deltas: hype and integrity each ∈ {-2, -1, 0, +1, +2}. Most should be ±1.
- timeoutSeconds: integer from 8 to 60 only (not seconds-per-line totals).
- choice "consequence": optional, ≤160 characters each if present.
- imagePrompt: ≤220 chars. Setting + character action + mood + composition. NEVER style words (no "comic", "cel-shaded", "illustration") — the renderer prepends those.
- DO NOT resolve the run in dialogue. The player chooses when to end. Each scene leaves a hook.

SHARE MOMENT (OPTIONAL FIELD — default is to OMIT):
- The player just made a choice. If — and only if — that choice (or this scene's beat) is genuinely brag-worthy, you MAY include a "shareMoment" object.
- Trigger criteria (need at least one): a famous archetype just appeared (Thiel-coded VC, Sam-coded mentor, etc.); the player made a contrarian/bold call against the obvious option; a stat just crossed |hype| ≥ 4 or |integrity| ≥ 4; a stat reversed sign (e.g. went from +2 to -1).
- Frequency budget: aim for at most one shareMoment per 5 scenes. When in doubt, OMIT.
- title: ≤8 words, present-tense, punchy ("You walked from $5M."). Speaks to the player as "you".
- blurb: 1–2 sentences, ≤180 chars, MUST name a specific in-fiction detail (the cameo archetype, a place, a dollar figure, the founder's startupName). Generic copy is forbidden — no "you made a bold move", no "what a moment".
- If you cannot satisfy the specificity rule, omit shareMoment entirely.

ABSOLUTE PROHIBITIONS (override the outline if they conflict):
- The cofounder speaker has no fixed first name from the roster ("Stranger" is a label only). Use a name only if "Team" facts name someone, verbatim.
- If the player's Team says "solo" / "no cofounder": do NOT speak as if a cofounder is already in the player's life. The cofounder archetype, if assigned, is a stranger trying to attach themselves OR a memory/ghost — never a current partner.
- If the player named a cofounder (e.g. "my cofounder Anna"), use that name verbatim. Never substitute a different name.
- If Funding says "bootstrapping": do NOT reference term sheets the player has, equity advisory clauses, or VC drama in motion. VC scenes are cold solicitations, not active deals.

ANTI-CLICHÉ OPENERS (the "phone buzzes" scrub):
- DO NOT open scenes with "your phone buzzes/vibrates/lights up", "a Slack ping", "your inbox pings", "a notification arrives", "your email refreshes", "your Twitter mentions explode", or any "device interrupts you" framing. These are the LLM-default scene openers and they recur across every player and every scene — exactly the bug we're fixing.
- Open instead with: a place ("Sightglass at 4pm; the espresso line snakes out the door"), an interior ("you've been staring at the second slide for twenty minutes"), an action ("you push your laptop away and walk to the window"), or in-progress dialogue ("'so the gap year was YC,' she says, mid-sentence, like the answer was already obvious").
- The chosen storylet's beat already establishes the situation — let the dialogue/narration enter that situation already in motion, not as a fresh notification arriving.
- This rule has NO exceptions for storylets whose source beat references a device event ("Sentry alert", "X locks your account"). Render the consequence and the player's action — not the buzz/ping itself.

CAST LIST LOCK (anti-retroactive-worldbuilding + anti-cliché — see Hidden Door + Drama Llama findings in STORYLETS.md):
- The ONLY named characters you may reference are: (a) the player's startup, (b) the player's cofounder if "Team" names one, (c) REAL PUBLIC FIGURES already named in the scene's beat (Peter Thiel, Sam Altman, Paul Graham, Garry Tan, Marc Andreessen, etc. — these came from the cameo engine and are intentional).
- Do NOT invent new named NPCs ("Jessica from Sequoia", "Arman the technical lead", etc.). Strangers stay strangers.
- ANTI-CLICHÉ NAME SCRUB: If the input beat contains a generic first name that is NOT a real public figure (e.g. "Victor", "Sandra", "Chad", "Sarah", "Mike", "Marcus" — typical LLM defaults), TREAT IT AS A PLACEHOLDER ONLY. In your rendered scene, refer to that NPC by their archetype role ("the partner", "the reporter", "the mentor") — never by the placeholder name. The same default names recurring across players is exactly the bug we're scrubbing.
- The speaker for THIS scene is the assigned archetype — do not introduce a second named character into the dialogue.

OUTPUT SHAPE:
{
  "id": number,
  "title": string,
  "archetype": "vc"|"cofounder"|"reporter"|"hater"|"mentor" (exactly; same as THIS SCENE in outline),
  "imagePrompt": string,
  "dialogue": [{ "speaker": same archetype key OR "player" OR "narrator", "text": string }],
  "choices": [{ "id": "a"|"b"|"c", "label": string, "consequence": string, "hype": number, "integrity": number }],
  "timeoutSeconds": number,
  "timeoutChoiceId": "a"|"b"|"c",
  "shareMoment"?: { "title": string, "blurb": string }   // OPTIONAL — see SHARE MOMENT rules; usually omit
}`

function formatArcSummary(arc: ArcSkeleton): string {
  const lines: string[] = []
  lines.push(`Episode ${arc.episodeIndex} premise: ${arc.premise}`)
  lines.push('Group outlines (each group = 4 sub-scenes with the same archetype, same location):')
  // Skip placeholder outlines from a streaming-partial skeleton (see
  // makePartialArcSkeleton in page.tsx). The first scene-gen of each
  // episode is fired before the full arc finishes streaming; only the
  // current (real) outline is shown to keep cross-group context honest.
  arc.scenes.forEach((s) => {
    if (s.beat === '__pending') return
    lines.push(`  group ${s.index}: ${s.archetype} — ${s.beat}${s.hingesOn ? ` (hinges on: ${s.hingesOn})` : ''}`)
  })
  return lines.join('\n')
}

function formatRecentChoices(choices: PriorChoiceSummary[]): string {
  if (choices.length === 0) return '(none)'
  return choices
    .map(
      (c) =>
        `Scene ${c.sceneId}: "${c.choiceLabel}" (hype ${c.hypeDelta >= 0 ? '+' : ''}${c.hypeDelta}, integrity ${c.integrityDelta >= 0 ? '+' : ''}${c.integrityDelta})`,
    )
    .join('\n')
}

// Choice-illusion fix: surface the single most-recent choice and its
// stat delta in its OWN block at the top of the live prompt, separate
// from the bulk recent-choices history. The dialogue must acknowledge
// this choice's effect — without this hoist, the renderer tends to
// produce prose that floats free of what the player actually picked.
// See STORYLETS.md (Hidden Door findings).
function formatPriorChoiceCallout(
  choices: PriorChoiceSummary[],
): string | null {
  if (choices.length === 0) return null
  const last = choices[choices.length - 1]!
  const hypeStr = `${last.hypeDelta >= 0 ? '+' : ''}${last.hypeDelta}`
  const integStr = `${last.integrityDelta >= 0 ? '+' : ''}${last.integrityDelta}`
  return `## PRIOR CHOICE — THE PROTAGONIST'S LITERAL ACTION
The player just chose: "${last.choiceLabel}"
Effect: hype ${hypeStr}, integrity ${integStr}.

Read the choice label as a verb-phrase the player just ENACTED. It's
not a tone modifier — it's THE action the protagonist took. This scene
shows what happens because of that action, not what would have happened
anyway. The opening sentence should make it obvious which of the prior
choices the player picked; a reader joining cold should be able to
reverse-engineer the choice from the first line.`
}

export function buildScenePromptParts(input: BuildScenePromptInput) {
  const arche = ARCHETYPES[input.outline.archetype]
  const arcSummary = formatArcSummary(input.arcSkeleton)

  // Cached block: stable across all scene calls in the same episode.
  // Replaces the prior "dump all history" approach with a compressed summary.
  const cachedContext = `## CHARACTER (this scene's speaker)
JSON keys — use EXACTLY for "archetype" and for NPC dialogue "speaker": ${input.outline.archetype}
Role card (voice flavor only; never paste this label into JSON): ${arche.name}, ${arche.title}.
Personality: ${arche.personality}
${
  input.outline.archetype === 'cofounder'
    ? '\nNote: "Stranger" is UI flavor only — not a spoken name. If Team facts say solo, they must not claim to be an existing cofounder unless Team names someone.'
    : ''
}

## CURRENT EPISODE SKELETON
${arcSummary}

## STORY SO FAR (compressed, covers everything before this episode)
${input.storySoFar ?? '(this is the opening episode — no prior summary)'}

## PLAYER STATE
Startup: ${input.startupName}
Pitch: ${input.startupDescription || '(unstated)'}
Founder vibe: ${input.founderPersona || '(unstated)'}
Stage: ${input.stage || '(unstated)'}

## PLAYER FACTS (HONOR THESE — never invent contradictions)
Team: ${input.team || '(unstated; do not invent a cofounder, treat as solo)'}
Funding: ${input.fundingModel || '(unstated; do not assume a fundraising track)'}
Target customer: ${input.targetCustomer || '(unstated; keep generic — don\'t invent a wrong segment)'}
Current concern: ${input.concern || '(unstated)'}`

  // Per-call (uncached): the recent choices + scene target.
  //
  // Each archetype encounter is rendered as 4 sub-scenes that share one
  // location and one image. Sub-scene 0 opens the encounter; 1–3 progress
  // the same conversation, reacting to the player's prior choice. The
  // imagePrompt for sub 1–3 must describe the SAME setting as sub 0 —
  // the renderer reuses sub 0's image regardless, but consistency in the
  // narrated setting matters for the dialogue.
  // Sub 1-3 are generated SEQUENTIALLY: each call is dispatched only after
  // the player has made their choice in the prior sub. recentChoices
  // therefore ALWAYS contains the immediately-prior pick, and the dialogue
  // must honor it as a literal in-fiction action — not gloss past it.
  // Storylet kind drives the rendering mode. Solo/world-event scenes
  // render with narrator + player only — no NPC of this archetype
  // speaks. The arc-skeleton schema carries kind through; encounter is
  // the default when missing (preserves old skeleton behavior).
  const kind = input.outline.kind ?? 'encounter'
  const kindBlock =
    kind === 'solo'
      ? `## SCENE KIND: SOLO (no NPC speaks)
This scene has NO NPC of any archetype as a speaking character. Dialogue uses ONLY "narrator" and "player" speakers. The "${arche.name}" archetype on this outline is a THEMATIC ANCHOR for tone/image — not a character that walks in.
Render the scene as: narrator describes the moment + place + time, player has 1–2 internal-monologue lines, the choices are about what the player does next (alone). No second character.`
      : kind === 'world-event'
        ? `## SCENE KIND: WORLD-EVENT (an event, not an encounter)
Something changed in the world; the player reacts. Dialogue is mostly "narrator" describing the event and its visible consequence, optionally one "player" line. The "${arche.name}" archetype is a THEMATIC ANCHOR for tone/image — an NPC of that archetype may be REFERENCED in narration ("a Thiel-coded VC's tweet went viral", "a competitor's blog post drops") but DOES NOT appear as a speaking character.
The choices are about what the player does in response to the event.`
        : ''

  const subSceneBlock =
    input.subSceneIndex === 0
      ? `## SUB-SCENE 0 of 4 (opens the situation)
This is the OPENING beat of a 4-beat sequence. Render the storylet's
anchor situation (see "Beat to render" below). Establish setting +
character + tension. End on a choice that the player's NEXT scene will
literally enact. Pick a location flexible enough that any of the
choices' consequences (calling someone, walking out, agreeing, lying,
etc.) can plausibly play out from here or just past here.`
      : `## SUB-SCENE ${input.subSceneIndex} of 4 — RENDER THE PLAYER'S CHOICE AS ACTION

CRITICAL — read this carefully, this is the architectural rule:
The PRIOR CHOICE above is NOT a tone modifier or a dialogue cue. It is
LITERALLY THE PROTAGONIST'S ACTION that drives this scene. The
storylet's anchor situation is ALREADY established (sub-scene 0 did
that). This scene shows what happens BECAUSE the player chose what
they chose.

Read the choice's label as a verb-phrase the player just enacted:
  - "Call her"             → scene opens with the player on the phone,
                              hearing it ring or her voice answering.
                              The setting shifts from indoor table to
                              outside / a quiet corner. Render the call.
  - "Submit the form"      → scene opens with the player clicking
                              submit, the confirmation flashing,
                              dread or relief. The application is GONE
                              from the screen.
  - "Walk out"             → the player is OUTSIDE, on the sidewalk,
                              the door closing behind them. The
                              previous character's voice fades.
  - "Take the term sheet"  → the contract is signed; the VC offers
                              their hand; what comes next?
  - "Push back on..."      → the verbal counter lands; the recipient
                              reacts in character; the conversation
                              has shifted register.
  - "Ask for the deck"     → the deck is now being shared; the
                              player is reading it. New material.
  - "Tell them you're solo" → the deflection lands; the recipient
                              processes the rejection. Different beat.

DO NOT reuse the storylet's anchor beat ("the cursor blinks", "the
email sits open", "you're staring at the deck"). That was sub-scene 0.
This scene is a NEW MOMENT, branched from the choice. The player has
moved time and/or space forward.

Setting: the image was generated for sub-scene 0's location. Narration
can shift to a nearby beat (the cafe doorway, the office hallway,
outside the bar) — pick something within walking distance of sub-0's
setting so the image still feels right. Don't teleport across the city.

Character: if the choice involves leaving someone, they may NOT
return in this scene. If the choice is verbal, the same NPC continues
the conversation. If the choice triggers a phone call, the new
character is on the line — render their voice via dialogue speaker.

Dialogue: the FIRST line should make it OBVIOUS which choice was made.
A reader picking up at this scene cold should be able to reverse-engineer
the player's choice from the opening sentence.
${
  input.subSceneIndex === 3
    ? '\nThis is sub-scene 3 — the final beat. Close the encounter cleanly so the next archetype can enter; leave a hook, do NOT resolve the run.'
    : ''
}`

  const priorChoiceBlock = formatPriorChoiceCallout(input.recentChoices)

  const liveBlock = `${input.tone ? `${input.tone.oneLiner}\n\n` : ''}${priorChoiceBlock ? `${priorChoiceBlock}\n\n` : ''}## RECENT CHOICES (last few only)
${formatRecentChoices(input.recentChoices)}

Current stats — hype ${input.currentStats.hype}, integrity ${input.currentStats.integrity}.

${kindBlock ? `${kindBlock}\n\n` : ''}${subSceneBlock}

## THIS SCENE
Episode ${input.episodeIndex}, group ${input.groupIndex} sub ${input.subSceneIndex} (id=${input.sceneId})
${
  input.subSceneIndex === 0
    ? // Sub 0: render the storylet's anchor beat verbatim. This is the
      // canonical situation the storylet template encodes.
      `Beat to render: ${input.outline.beat}
${input.outline.hingesOn ? `Should hinge on: ${input.outline.hingesOn}` : ''}`
    : // Sub 1-3: do NOT re-anchor to the storylet's beat. The beat is
      // shown as STORYLET CONTEXT (so the model knows the broader
      // situation) but the actual scene is whatever follows from the
      // PRIOR CHOICE. This is the architectural fix for "every sub-scene
      // re-loops the same beat" — passing the storylet beat as "Beat to
      // render" was pulling Haiku back to the anchor every time.
      `Storylet context (already established by sub-scene 0): ${input.outline.beat}
${input.outline.hingesOn ? `Storylet pivot point: ${input.outline.hingesOn}` : ''}

Render the scene that follows from the player's PRIOR CHOICE above.
Do NOT re-render the storylet context — that's already happened.`
}

Output the JSON object for this scene now.`

  return {
    systemBlocks: [
      { text: SCENE_SYSTEM_RULES, cache: false },
      { text: cachedContext, cache: true },
    ],
    userBlocks: [{ text: liveBlock, cache: false }],
  }
}
