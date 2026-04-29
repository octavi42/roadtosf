import { ARCHETYPES } from "@/lib/archetypes";
import type { Archetype, CastMember } from "@/lib/types";

// Narrator gets its own voice so it doesn't collide with the VC archetype's
// default. Warwick — deep narrator-leaning male.
export const NARRATOR_VOICE_ID = "6SMKBar4Q5wkVHdFlcQC";

// Jordan is the authored "friend in SF" character (scenes 1–4). Mia —
// warm, expressive, conversational young female.
export const JORDAN_VOICE_ID = "052jzHJceQiZr7ltnY0C";

// The player's own lines (LLM scenes occasionally voice the founder back).
// Caldwell — confident, casual young male. Generic founder read.
export const PLAYER_VOICE_ID = "nqvoG2qlLhOhieQPdowv";

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

  // Player's own words — voiced with the player's default voice.
  if (lower === "player" || lower === "you" || lower === "founder") {
    return PLAYER_VOICE_ID;
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

/**
 * Cast-aware voice lookup. The cast member resolved by role carries a
 * pre-assigned voiceId (see assignVoicesToEpisode). Falls back to the
 * role-default when the cast is missing, the role isn't in the cast,
 * or the cast member lacks a voiceId — preserving the prior behavior.
 *
 * Returns null when the speaker is unrecognized (e.g. a typo'd role).
 */
export function voiceIdForCastMember(
  speaker: string | undefined | null,
  cast: ReadonlyArray<CastMember> | undefined,
): string | null {
  if (!cast || cast.length === 0) return voiceIdForSpeaker(speaker);
  if (!speaker) return null;
  const lower = speaker.trim().toLowerCase();
  if (!ARCHETYPE_KEYS.has(lower as Archetype)) {
    // player / narrator / unrecognized — defer to the existing rules.
    return voiceIdForSpeaker(speaker);
  }
  const match = cast.find((c) => c.role === lower);
  if (match?.voiceId) return match.voiceId;
  return voiceIdForSpeaker(speaker);
}
