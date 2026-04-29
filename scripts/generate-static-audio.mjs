// Pregenerates ElevenLabs TTS for the hardcoded onboarding lines (welcome
// screen + authored scenes 1-8). Saves mp3 + per-character alignment JSON
// to public/voices/static/, and emits src/lib/static-audio-manifest.ts so
// useDialogueAudio can serve them locally instead of paying for /api/tts
// on every playthrough.
//
// Run after editing WELCOME_LINES (src/app/page.tsx) or SCENES
// (src/lib/scenes.ts):
//
//   npm run generate:static-audio
//
// Idempotent: skips lines whose hash already has files on disk. To force a
// regen, delete the matching files in public/voices/static/.
//
// IMPORTANT: keep the LINES array below in sync with:
//   - WELCOME_LINES in src/app/page.tsx
//   - SCENES.dialogue & SCENES.questions[].prompt in src/lib/scenes.ts
//   - Voice constants in src/lib/voices/speaker.ts

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// MUST match src/lib/voices/speaker.ts
const NARRATOR_VOICE_ID = "6SMKBar4Q5wkVHdFlcQC";
const JORDAN_VOICE_ID = "052jzHJceQiZr7ltnY0C";

// MUST match src/app/api/tts/route.ts so the precomputed audio matches
// what /api/tts would have produced (same model, same format).
const MODEL_ID = "eleven_flash_v2_5";
const OUTPUT_FORMAT = "mp3_44100_128";

const N = NARRATOR_VOICE_ID;
const J = JORDAN_VOICE_ID;

const LINES = [
  // ---- Welcome (4 narrator lines) ----
  { voiceId: N, text: "A few thousand people move to San Francisco every year to start a company." },
  { voiceId: N, text: "Some of them become legends." },
  { voiceId: N, text: "Most become a story other founders tell at dinner." },
  { voiceId: N, text: "Tonight, you find out which." },

  // ---- Scene 1 — "Who you are" (3 narrator lines) ----
  { voiceId: N, text: "Before we get to the company, who are you?" },
  { voiceId: N, text: "First-timer, second exit, somewhere weirder?" },
  { voiceId: N, text: "Three sentences. Skip the deck voice." },

  // ---- Scene 2 — "What you've been telling strangers" (3 narrator lines) ----
  { voiceId: N, text: "Now the other one." },
  { voiceId: N, text: "The one with numbers. The one you'd say to a stranger sober." },
  { voiceId: N, text: "What are you building?" },

  // ---- Scene 3 — "The decision" (3 narrator lines) ----
  { voiceId: N, text: "One ticket. One direction. Non-refundable." },
  { voiceId: N, text: "Most people stop here." },
  { voiceId: N, text: "The rest of you become the story." },

  // ---- Scene 4 — "Pickup" (4 jordan dialogue + 3 jordan question prompts) ----
  { voiceId: J, text: "Jordan. Three years older on paper, ten in the head." },
  { voiceId: J, text: "I'm here because nobody else was going to drive at this hour." },
  { voiceId: J, text: "Bag in the back. The bridge takes thirty minutes." },
  { voiceId: J, text: "I have three questions, and you owe me honest answers." },
  { voiceId: J, text: "Who's in this with you, if anyone?" },
  { voiceId: J, text: "Who's paying for the next 90 days?" },
  { voiceId: J, text: "What's the thing you don't say to investors?" },

  // ---- Narrator lobby (between authored scenes and first generated episode) ----
  // Keep in sync with NARRATOR_LOBBY_OPENER in src/components/NarratorLobby.tsx
  // and the off-topic fallback line.
  { voiceId: N, text: "You've got a minute before the city gets its hooks in. Anything you want to ask before it does?" },
  { voiceId: N, text: "That one I can't answer. Ask me something else about the city." },
];

const OUT_DIR = path.join(ROOT, "public", "voices", "static");
const MANIFEST_PATH = path.join(ROOT, "src", "lib", "static-audio-manifest.ts");

function hashOf(voiceId, text) {
  return crypto
    .createHash("sha1")
    .update(`${MODEL_ID}|${voiceId}|${text}`)
    .digest("hex")
    .slice(0, 16);
}

function manifestKey(voiceId, text) {
  return `${voiceId}:${text}`;
}

async function generateOne(client, line) {
  const hash = hashOf(line.voiceId, line.text);
  const audioPath = path.join(OUT_DIR, `${hash}.mp3`);
  const alignmentPath = path.join(OUT_DIR, `${hash}.json`);
  const audioUrl = `/voices/static/${hash}.mp3`;
  const alignmentUrl = `/voices/static/${hash}.json`;

  if (fsSync.existsSync(audioPath) && fsSync.existsSync(alignmentPath)) {
    process.stdout.write(`skip   ${hash}  ${line.text.slice(0, 56)}\n`);
    return { hash, audioUrl, alignmentUrl };
  }

  process.stdout.write(`gen    ${hash}  ${line.text.slice(0, 56)}\n`);
  const result = await client.textToSpeech.convertWithTimestamps(line.voiceId, {
    text: line.text,
    modelId: MODEL_ID,
    outputFormat: OUTPUT_FORMAT,
  });

  if (!result.audioBase64) {
    throw new Error(`Empty audioBase64 for: ${line.text}`);
  }
  if (!result.alignment) {
    throw new Error(`Missing alignment for: ${line.text}`);
  }

  await fs.writeFile(audioPath, Buffer.from(result.audioBase64, "base64"));
  await fs.writeFile(alignmentPath, JSON.stringify(result.alignment));

  return { hash, audioUrl, alignmentUrl };
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Run with: node --env-file=.env.local scripts/generate-static-audio.mjs",
    );
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const client = new ElevenLabsClient({ apiKey });

  const manifest = {};
  let generated = 0;
  let skipped = 0;

  for (const line of LINES) {
    const before = fsSync.existsSync(
      path.join(OUT_DIR, `${hashOf(line.voiceId, line.text)}.mp3`),
    );
    const { audioUrl, alignmentUrl } = await generateOne(client, line);
    if (before) skipped++;
    else generated++;
    manifest[manifestKey(line.voiceId, line.text)] = { audioUrl, alignmentUrl };
  }

  // Emit the runtime manifest. Sort keys so reruns don't churn git diffs.
  const sortedEntries = Object.entries(manifest).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const sortedManifest = Object.fromEntries(sortedEntries);

  const ts = `// AUTO-GENERATED by scripts/generate-static-audio.mjs.
// Do not edit by hand. Re-run \`npm run generate:static-audio\` to update.
//
// Maps (voiceId, text) -> {audioUrl, alignmentUrl} for the hardcoded
// onboarding lines (welcome + scenes 1-8). Lines present here are served
// from public/voices/static/ instead of /api/tts (zero ElevenLabs cost).
// Lines NOT present (e.g. LLM-generated dialogue) fall back to live TTS.

export interface StaticAudioEntry {
  audioUrl: string;
  alignmentUrl: string;
}

export const STATIC_AUDIO_MANIFEST: Record<string, StaticAudioEntry> = ${JSON.stringify(
    sortedManifest,
    null,
    2,
  )};

export function staticAudioKey(voiceId: string, text: string): string {
  return \`\${voiceId}:\${text}\`;
}
`;

  await fs.writeFile(MANIFEST_PATH, ts);
  process.stdout.write(
    `\n${LINES.length} lines: ${generated} generated, ${skipped} skipped (already cached).\n`,
  );
  process.stdout.write(`Manifest: ${MANIFEST_PATH}\n`);
  process.stdout.write(`Audio dir: ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
