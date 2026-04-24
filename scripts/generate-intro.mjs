import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STYLE_REF = path.join(ROOT, "references", "style-ref.png");
const SILICON_DIR = path.join(ROOT, "references", "silicon-mania");
const FACE_REF_FILES = [
  "Screenshot 2026-04-24 at 5.19.53 PM.png",
  "Screenshot 2026-04-24 at 5.19.59 PM.png",
  "Screenshot 2026-04-24 at 5.24.37 PM.png",
];

const QUALITY = process.env.QUALITY ?? "medium";
const SIZE = process.env.SIZE ?? "1536x1024";
const OUT_DIR =
  QUALITY === "medium"
    ? path.join(ROOT, "public", "intro-v3")
    : path.join(ROOT, "public", `intro-v3-${QUALITY}`);

const CHARACTER_DIRECTIVE =
  "CHARACTER STYLE — match the reference frames exactly: oversized white sclera with small black pupil dots (googly cartoon eyes), oversized expressive mouth (open, mid-speech, mid-laugh, or mid-grimace — never neutral or placid), heightened satirical caricature proportions, slightly chunky and exaggerated. The character must feel like a still pulled directly from the reference adult-animation TV show — Bojack / Mr. Burns / Inside Job lineage — NOT a polished Disney or Pixar character, NOT a soft indie animation character, NOT an editorial illustration character.";

const NO_CHARACTER_DIRECTIVE =
  "STRICT — do NOT add any central foreground character with a visible face. Any human presence is limited to anonymous silhouettes, hands, or distant background figures. The subject of this frame is the environment / object, not a person.";

const SHOTS = [
  {
    id: "01-departure-board",
    useFaceRefs: false,
    title: "an airport departure board, the player's flight to SFO is in 6 hours",
    imageStyle:
      "A massive airport departure board drawn as a dark rectangular panel, with rows of flight listings drawn as small stylized text blocks. ONE row stands out — destination SAN FRANCISCO, status BOARDING, drawn larger and in a brighter color than the rest. Two or three anonymous traveler silhouettes walk past in the foreground, drawn as simple inked shapes with flat dark fill.",
    composition:
      "Wide low-angle frame looking up at the board, drawn terminal architecture (ceiling beams, light fixtures) creating strong leading lines toward the board",
    lighting:
      "Cool blue-grey wash on the terminal surfaces and a warm orange-amber wash on the board itself, rendered as flat color zones with simple hard-edged shadow shapes — no gradients, no glow effects",
    textRule:
      "Allow stylized hand-drawn board text only: 'SAN FRANCISCO', 'BOARDING', '06:00'. No other legible text anywhere.",
  },
  {
    id: "02-ticket-counter",
    useFaceRefs: false,
    title: "buying the ticket — a transaction at an airline counter",
    imageStyle:
      "Close-up over an airline ticket counter drawn in clean inked lines. One anonymous hand slides a black credit card across the counter surface; an agent's uniformed hand reaches to receive it. A boarding pass and passport sit flat on the counter. Background: a generic corporate airline logo wall, drawn with simplified flat shapes and less detail than the foreground.",
    composition:
      "Tight overhead three-quarter angle on the counter surface, hands as the subject, no faces, no full bodies",
    lighting:
      "Daytime terminal light rendered as flat color zones — a brighter warm tone on the counter surface and a cooler tone in the background. Simple hard-edged cel shadows under the hands and objects.",
    textRule:
      "Boarding pass and passport text is drawn as abstract squiggles only — zero legible characters.",
  },
  {
    id: "03-airport-bar",
    useFaceRefs: true,
    title: "a quiet late-night airport bar, the player talking through their plans",
    imageStyle:
      "A nearly empty late-night airport bar. POV from a barstool: a half-finished whiskey in the foreground on the wooden bar top. Across the bar, a bartender mid-pour, drawn as a satirical adult-animation character that looks like it was pulled directly from the reference frames — googly cartoon eyes, oversized mouth caught mid-speech, exaggerated caricature features, slightly chunky proportions. Behind the bar, large windows frame a stylized view of planes parked on the tarmac, with runway lights drawn as small glowing circles.",
    composition:
      "Eye-level POV from the player's seat, whiskey glass anchoring the lower left, bartender as the midground subject filling roughly one third of the frame, window view as the background",
    lighting:
      "Warm amber bar interior and cool blue exterior, rendered as flat color zones — no gradients, no photographic depth-of-field blur. Bar surface highlights are drawn as simple flat shapes, not glossy reflections.",
    textRule:
      "No legible text anywhere. Bottle labels behind the bartender are drawn as abstract colored shapes only.",
  },
  {
    id: "04-boarding-pass",
    useFaceRefs: false,
    title: "the ticket is purchased — a single boarding pass close-up",
    imageStyle:
      "Top-down view of a single boarding pass resting on a worn duffel bag or vinyl airport seat. The pass is drawn as a clean inked rectangle with a destination strip, a barcode rendered as a simple block of vertical lines, and one small airline icon. The bag or seat under the pass is drawn with less detail and slightly softer lines than the pass itself — still hand-drawn, just simplified.",
    composition:
      "Overhead angle, boarding pass centered and filling roughly 60 percent of the frame",
    lighting:
      "Warm golden color wash across the scene, rendered as flat color zones with a subtle darker ring toward the frame edges — drawn, not photographic vignetting.",
    textRule:
      "Allow exactly ONE legible text element: 'SFO' on the destination strip of the boarding pass. All other glyphs are drawn as abstract squiggles.",
  },
  {
    id: "05-sfo-arrival",
    useFaceRefs: false,
    title: "landing at SFO — the arrivals curb at golden hour",
    imageStyle:
      "Wide view of SFO arrivals. Anonymous travelers spilling from the arrivals doors, drawn ONLY as simple inked silhouettes or distant background figures — no central foreground character. Palm trees frame the right side, drawn as graphic stylized shapes. A curbside line of black cars and a white Waymo, drawn with clean lines and flat color fills. Foreground left: a single hand only (no body, no face) holding an iPhone in three-quarter view, the phone screen showing a cartoon chat bubble. Hills and a sliver of bay visible in the background, drawn as simple layered color shapes.",
    composition:
      "Wide horizontal cinematic frame, phone-in-hand on the left third as foreground anchor, arrivals doors as midground, landscape behind. Absolutely no standing character figure anywhere in the foreground or midground.",
    lighting:
      "Golden-hour color palette — warm oranges and yellows from the right, cooler shadow tones on the left. Rendered as flat color zones with hard-edged cel shadows. Any sun or sky highlights are drawn as simple star or burst shapes, not photographic lens flare.",
    textRule:
      "Allow one small stylized 'SFO' sign on the terminal building. The phone chat bubble contains only abstract squiggles — no other readable text.",
  },
];

function buildPrompt(shot) {
  const { title, imageStyle, composition, lighting, textRule, useFaceRefs } = shot;
  const characterRule = useFaceRefs ? CHARACTER_DIRECTIVE : NO_CHARACTER_DIRECTIVE;
  return [
    `Hand-drawn intro frame from a satirical adult-animation TV show: ${title}.`,
    imageStyle,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    textRule,
    characterRule,
    "OVERALL STYLE — match the reference frames exactly. Thick hand-inked outlines on EVERYTHING (characters, props, buildings, vehicles, furniture). Flat cel-shaded color fills with simple hard-edged shadow shapes. Slight natural variation in line weight that reads as drawn-by-hand. NO photorealism. NO 3D rendering. NO lens blur, depth of field, bokeh, motion blur, or lens flare. NO smooth digital gradients. NO glow or bloom. NO polished Disney/Pixar look. NO soft indie animation feel. NO editorial illustration look. The target is satirical adult-animation TV — chunky, irreverent, expressive — not pretty illustration.",
    "No subtitles, no UI overlays, no watermarks.",
  ].join(" ");
}

async function loadRefs(useFaceRefs) {
  const refs = [];
  refs.push(
    await toFile(fs.createReadStream(STYLE_REF), "style-ref.png", { type: "image/png" }),
  );
  if (useFaceRefs) {
    for (const fname of FACE_REF_FILES) {
      const fpath = path.join(SILICON_DIR, fname);
      if (!fs.existsSync(fpath)) {
        throw new Error(`Face reference missing: ${fpath}`);
      }
      refs.push(await toFile(fs.createReadStream(fpath), fname, { type: "image/png" }));
    }
  }
  return refs;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing. Run with: npm run generate:intro");
  }
  if (!fs.existsSync(STYLE_REF)) {
    throw new Error(`style-ref.png not found at ${STYLE_REF}. Run npm run distill:style first.`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(`[intro] quality=${QUALITY} size=${SIZE} out=${OUT_DIR}`);

  const runOne = async (shot) => {
    const outPath = path.join(OUT_DIR, `${shot.id}.png`);
    const refs = await loadRefs(shot.useFaceRefs);
    const t0 = Date.now();
    const response = await openai.images.edit({
      model: "gpt-image-2",
      image: refs,
      prompt: buildPrompt(shot),
      size: SIZE,
      quality: QUALITY,
      output_format: "png",
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image data returned for ${shot.id}`);
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    console.log(
      `[intro] ${shot.id} (${refs.length} refs) done in ${dt}s -> ${outPath}`,
    );
  };

  const results = await Promise.allSettled(SHOTS.map(runOne));
  const failed = results
    .map((r, i) => (r.status === "rejected" ? { shot: SHOTS[i].id, reason: r.reason } : null))
    .filter(Boolean);

  if (failed.length > 0) {
    console.error(`[intro] ${failed.length} failed:`);
    failed.forEach((f) => console.error(`  - ${f.shot}: ${f.reason}`));
    process.exit(1);
  }

  console.log(`[intro] all ${SHOTS.length} shots written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("[intro] failed:", err);
  process.exit(1);
});
