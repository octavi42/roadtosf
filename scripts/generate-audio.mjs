import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_AMBIENCE = path.join(ROOT, "public", "audio", "ambience");
const OUT_MUSIC = path.join(ROOT, "public", "audio", "music");

const FORCE = process.env.FORCE === "1";
const KEY_FILTER = process.env.KEY ?? null;

// 30s seamless ambience loops. Web Audio crossfader handles scene swaps;
// in-track looping is handled by the SFX `loop: true` flag.
const AMBIENCE = [
  {
    key: "home",
    prompt:
      "Quiet apartment at 1am, faint refrigerator hum, distant city through a closed window, occasional soft keyboard tap, no music, no speech, no traffic.",
  },
  {
    key: "sfo-arrival",
    prompt:
      "Inside a car driving on the Bay Bridge, low road rumble, faint wind, muffled tires on expansion joints, no radio, no speech, no music.",
  },
  {
    key: "mission",
    prompt:
      "San Francisco Mission District sidewalk at golden hour, distant Caltrain horn, light foot traffic, occasional bus pass-by, faint wind through palm fronds, no clear speech, no music.",
  },
  {
    key: "rosewood",
    prompt:
      "Quiet upscale hotel bar, low murmured conversation in the deep background, glassware clinking softly, no music, no laughter spikes.",
  },
  {
    key: "yc-batch-house",
    prompt:
      "Cluttered house at night, soft mechanical keyboard typing, distant fridge, occasional pacing footsteps on hardwood, no speech, no music.",
  },
];

// 60s instrumental beds keyed by ending quadrant. Looped at runtime by
// `<audio loop>`; runtime crossfade masks the seam.
const MUSIC = [
  {
    key: "ipo",
    prompt:
      "Triumphant minimal synth bed, slow steady pulse, hopeful major chords, restrained — like an Apple keynote credits roll. Loopable, no melodic hook, instrumental only.",
  },
  {
    key: "indicted",
    prompt:
      "Tense minor-key synth bed, low pulsing bass, distant detuned strings, the feeling of a slow news cycle turning against you. Instrumental, ambient, loopable.",
  },
  {
    key: "ai-wrapper",
    prompt:
      "Quiet melancholic ambient pad, sparse piano notes, the feeling of writing a Substack post at 2am about going back to basics. Instrumental, slow, loopable.",
  },
  {
    key: "acquihire",
    prompt:
      "Resigned mid-tempo ambient bed, muted synths, the feeling of signing a non-compete. Neutral, neither uplifting nor sad. Instrumental, loopable.",
  },
];

async function streamToBuffer(stream) {
  const ab = await new Response(stream).arrayBuffer();
  return Buffer.from(ab);
}

async function generateAmbience(client, item) {
  const out = path.join(OUT_AMBIENCE, `${item.key}.mp3`);
  if (!FORCE && fs.existsSync(out)) {
    console.log(`[ambience] ${item.key} already exists, skipping (FORCE=1 to override)`);
    return;
  }
  const t0 = Date.now();
  const stream = await client.textToSoundEffects.convert({
    text: item.prompt,
    durationSeconds: 30,
    loop: true,
    promptInfluence: 0.6,
    modelId: "eleven_text_to_sound_v2",
    outputFormat: "mp3_44100_128",
  });
  const buf = await streamToBuffer(stream);
  fs.writeFileSync(out, buf);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[ambience] ${item.key} ${(buf.length / 1024).toFixed(0)}KB in ${dt}s -> ${out}`);
}

async function generateMusic(client, item) {
  const out = path.join(OUT_MUSIC, `${item.key}.mp3`);
  if (!FORCE && fs.existsSync(out)) {
    console.log(`[music] ${item.key} already exists, skipping (FORCE=1 to override)`);
    return;
  }
  const t0 = Date.now();
  const stream = await client.music.compose({
    prompt: item.prompt,
    musicLengthMs: 60000,
    modelId: "music_v1",
    forceInstrumental: true,
    outputFormat: "mp3_44100_128",
  });
  const buf = await streamToBuffer(stream);
  fs.writeFileSync(out, buf);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[music] ${item.key} ${(buf.length / 1024).toFixed(0)}KB in ${dt}s -> ${out}`);
}

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY missing. Run with: npm run generate:audio");
  }

  fs.mkdirSync(OUT_AMBIENCE, { recursive: true });
  fs.mkdirSync(OUT_MUSIC, { recursive: true });

  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

  const ambienceTargets = KEY_FILTER
    ? AMBIENCE.filter((a) => a.key.includes(KEY_FILTER))
    : AMBIENCE;
  const musicTargets = KEY_FILTER
    ? MUSIC.filter((m) => m.key.includes(KEY_FILTER))
    : MUSIC;

  if (KEY_FILTER && ambienceTargets.length === 0 && musicTargets.length === 0) {
    throw new Error(
      `KEY="${KEY_FILTER}" matched no entries. Available: ${[
        ...AMBIENCE.map((a) => `ambience/${a.key}`),
        ...MUSIC.map((m) => `music/${m.key}`),
      ].join(", ")}`,
    );
  }

  console.log(
    `[audio] generating ${ambienceTargets.length} ambience + ${musicTargets.length} music`,
  );

  const tasks = [
    ...ambienceTargets.map((a) => ["ambience", a.key, () => generateAmbience(client, a)]),
    ...musicTargets.map((m) => ["music", m.key, () => generateMusic(client, m)]),
  ];

  const results = await Promise.allSettled(tasks.map(([, , fn]) => fn()));
  const failed = results
    .map((r, i) =>
      r.status === "rejected"
        ? { kind: tasks[i][0], key: tasks[i][1], reason: r.reason }
        : null,
    )
    .filter(Boolean);

  if (failed.length > 0) {
    console.error(`[audio] ${failed.length} failed:`);
    failed.forEach((f) => console.error(`  - ${f.kind}/${f.key}: ${f.reason}`));
    process.exit(1);
  }

  console.log(`[audio] done`);
}

main().catch((err) => {
  console.error("[audio] failed:", err);
  process.exit(1);
});
