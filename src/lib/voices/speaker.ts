import { ARCHETYPES } from "@/lib/archetypes";
import type { Archetype } from "@/lib/types";

// Narrator gets its own voice so it doesn't collide with the VC archetype's
// default. Warwick — deep narrator-leaning male.
export const NARRATOR_VOICE_ID = "6SMKBar4Q5wkVHdFlcQC";

// Jordan is the authored "friend in SF" character (scenes 1–4). Mia —
// warm, expressive, conversational young female.
export const JORDAN_VOICE_ID = "052jzHJceQiZr7ltnY0C";

const ARCHETYPE_KEYS = new Set(Object.keys(ARCHETYPES) as Archetype[]);

/**
 * Resolves the ElevenLabs voice ID for a dialogue speaker. The speaker
 * string can come from two sources:
 *   - Authored scenes (src/lib/scenes.ts): display strings like
 *     "Narrator" or "Jordan · Friend, SF".
 *   - LLM scenes (post-coercion): one of the archetype keys, "player",
 *     or "narrator" — all lowercase.
 *
 * Returns null when the line should not be voiced (player lines — the
 * player's own words) or when the speaker is unrecognised.
 *
 * Will be replaced once the cast lives on the StoryArc; this is the
 * fallback the cast resolver also falls back to.
 */
export function voiceIdForSpeaker(
  speaker: string | undefined | null,
): string | null {
  if (!speaker) return null;
  const s = speaker.trim();
  const lower = s.toLowerCase();

  // Player's own words — never voiced.
  if (lower === "player" || lower === "you" || lower === "founder") {
    return null;
  }

  // Narrator (both authored "Narrator" and LLM-normalized "narrator").
  if (lower === "narrator" || lower.includes("narrator")) {
    return NARRATOR_VOICE_ID;
  }

  // Authored Jordan persona — "Jordan · Friend, SF".
  if (lower.startsWith("jordan")) {
    return JORDAN_VOICE_ID;
  }

  // LLM-normalized archetype keys.
  if (ARCHETYPE_KEYS.has(lower as Archetype)) {
    return ARCHETYPES[lower as Archetype].defaultVoiceId;
  }

  return null;
}
