// Smart Q&A extraction. Fired once after scene 2 (the pitch text input). One
// Haiku round-trip both extracts whatever was already stated AND, for the
// missing pieces, generates an in-character follow-up Jordan would ask in the
// car ride (scene 4). When everything is already covered, scene 4 auto-advances
// with a single Jordan beat.

export interface BuildExtractPromptInput {
  startupDescription: string
  founderPersona: string
}

const EXTRACT_SYSTEM_RULES = `You are the fact-extraction engine for "Road to SF", a satirical comic-book founder game. You read the player's free-text pitch + a brief founder vibe, and you produce TWO things in a single JSON object:

1. "extracted": which of these 5 canonical facts are *clearly* stated already.
2. "missing": for each fact that is NOT clearly stated, an in-character follow-up question Jordan (the player's friend already in SF, picking them up at SFO) would ask in the car. Direct, warm, no pitch-deck tone.

CANONICAL FACTS:
- team: solo / cofounder name(s) / team size
- fundingModel: bootstrap / raised (round + size) / profitable / runway
- stage: idea / MVP / users / revenue (paying customers, ARR, etc.)
- targetCustomer: who the product is for (concrete persona/segment)
- concern: what is currently broken, scary, or keeping the founder up at night

HARD RULES:
- Output a single JSON object only. No prose, no markdown fences. Start with "{" end with "}".
- Each "extracted" field is OPTIONAL. Include the field ONLY when the pitch states it clearly. If unsure, OMIT the field — never invent.
- For each fact you OMIT in "extracted", you MUST add ONE corresponding object to "missing" with that field name and a question.
- Never write a question for a fact that is already in "extracted". The two halves of the output are mutually exclusive — every fact appears in exactly one of them.
- Each question is ≤220 chars, in Jordan's voice (warm friend, no pitch-deck jargon, slightly impatient bridge-traffic energy). One question per missing fact. Don't stack two questions in one.
- Quote / paraphrase the player's own words in the question when it sharpens it ("you said you've got users — paying or just signups?"). Do NOT contradict what the player already said.

OUTPUT SHAPE:
{
  "extracted": {
    "team"?: string,
    "fundingModel"?: string,
    "stage"?: string,
    "targetCustomer"?: string,
    "concern"?: string
  },
  "missing": [
    { "field": "team"|"fundingModel"|"stage"|"targetCustomer"|"concern", "question": string }
  ]
}`

export function buildExtractPromptParts(input: BuildExtractPromptInput) {
  const userBlock = `## PLAYER PITCH
${input.startupDescription || '(empty)'}

## FOUNDER VIBE
${input.founderPersona || '(unstated)'}

Extract the 5 facts you can be confident about, and write Jordan-voice follow-ups for the rest. Output the JSON object now.`

  return {
    systemBlocks: [{ text: EXTRACT_SYSTEM_RULES, cache: true }],
    userBlocks: [{ text: userBlock, cache: false }],
  }
}
