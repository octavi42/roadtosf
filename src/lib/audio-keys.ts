import type { EndingKey } from "./types";

export type AmbienceKey =
  | "home"
  | "sfo-arrival"
  | "mission"
  | "rosewood"
  | "yc-batch-house";

export type MusicKey = "ipo" | "indicted" | "ai-wrapper" | "acquihire";

const AMBIENCE_DIR = "/audio/ambience";
const MUSIC_DIR = "/audio/music";

export function ambiencePath(key: AmbienceKey): string {
  return `${AMBIENCE_DIR}/${key}.mp3`;
}

export function musicPath(key: MusicKey): string {
  return `${MUSIC_DIR}/${key}.mp3`;
}

// Background image path → ambience key. The intro/group images each map to
// one of the five pre-generated beds. Falls back to "home" for any unknown
// background so a missing mapping never breaks playback.
const BACKGROUND_TO_AMBIENCE: Record<string, AmbienceKey> = {
  "/intro-v2/01-departure-board.png": "home",
  "/intro-v2/03-airport-bar.png": "home",
  "/intro-v2/05-sfo-arrival.png": "sfo-arrival",
  "/groups/01-exploring-sf.png": "mission",
};

export function ambienceKeyForBackground(
  background: string | undefined | null,
  override?: AmbienceKey,
): AmbienceKey {
  if (override) return override;
  if (!background) return "home";
  return BACKGROUND_TO_AMBIENCE[background] ?? "mission";
}

// Ending → music. Ghosted intentionally returns null — narrative beat is
// "you never registered," ambience-only sells it.
export function musicKeyForEnding(ending: EndingKey): MusicKey | null {
  switch (ending) {
    case "ipo":
      return "ipo";
    case "indicted":
      return "indicted";
    case "ai-wrapper":
      return "ai-wrapper";
    case "acquihire":
      return "acquihire";
    case "ghosted":
      return null;
    default:
      return null;
  }
}
