import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STYLE_REF = path.join(ROOT, "references", "style-ref.png");
const QUALITY = process.env.QUALITY ?? "medium";
const SIZE = process.env.SIZE ?? "1536x1024";
const OUT_DIR =
  QUALITY === "medium"
    ? path.join(ROOT, "public", "intro")
    : path.join(ROOT, "public", `intro-${QUALITY}`);

const SHOTS = [
  {
    id: "01-departure-board",
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
    title: "a quiet late-night airport bar, the player talking through their plans",
    imageStyle:
      "A nearly empty late-night airport bar drawn in clean ink lines. POV from a barstool: a half-finished whiskey in the foreground on the wooden bar top. Across the bar, a bartender mid-pour, drawn with the same heightened cartoon proportions as the reference (big expressive eyes, exaggerated features), mildly amused expression. Behind the bar, large windows frame a stylized view of planes parked on the tarmac, with runway lights drawn as small glowing circles (not photographic bokeh).",
    composition:
      "Eye-level POV from the player's seat, whiskey glass anchoring the lower left, bartender as the midground subject, window view as the background",
    lighting:
      "Warm amber bar interior and cool blue exterior, rendered as flat color zones — no gradients, no photographic depth-of-field blur. Bar surface highlights are drawn as simple flat shapes, not glossy reflections.",
    textRule:
      "No legible text anywhere. Bottle labels behind the bartender are drawn as abstract colored shapes only.",
  },
  {
    id: "04-boarding-pass",
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
    title: "landing at SFO, the co-founder is already texting",
    imageStyle:
      "Wide view of SFO arrivals drawn in the same style as the reference. Anonymous travelers drawn as simple inked silhouettes or simplified cartoon figures spilling from the arrivals doors. Palm trees frame the right side of the frame, drawn as graphic stylized shapes. A curbside line of black cars and a white Waymo, drawn with clean lines and flat color fills. Foreground left: a single hand holding an iPhone in three-quarter view, the phone screen shows a cartoon chat bubble. Hills and a sliver of bay visible in the background, drawn as simple layered color shapes.",
    composition:
      "Wide horizontal cinematic frame, phone-in-hand anchored on the left third as foreground, arrivals doors as midground, landscape behind",
    lighting:
      "Golden-hour color palette — warm oranges and yellows from the right, cooler shadow tones on the left. Rendered as flat color zones with hard-edged cel shadows. Any sun or sky highlights are drawn as simple star or burst shapes, not photographic lens flare.",
    textRule:
      "Allow one small stylized 'SFO' sign on the terminal building. The phone chat bubble contains only abstract squiggles — no other readable text.",
  },
];

function buildPrompt({ title, imageStyle, composition, lighting, textRule }) {
  return [
    `Hand-drawn illustrated intro frame: ${title}.`,
    imageStyle,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    textRule,
    "CRITICAL — match the reference image exactly: thick clean ink outlines on EVERYTHING (characters, props, buildings, vehicles, furniture). Flat cel-shaded color fills in broad regions. Simple hard-edged shadow shapes, no smooth gradients. NO photorealism. NO 3D rendering. NO lens blur, depth of field, bokeh, motion blur, or lens flare. NO glow or bloom effects. Environments and props are drawn in the same cartoon register as the characters — an airport column or a credit card gets the same ink-and-flat-color treatment as a face. Satirical adult-animation still, like a frame captured directly from a prestige animated TV comedy.",
    "No subtitles, no UI overlays, no watermarks.",
  ].join(" ");
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
    const styleFile = await toFile(
      fs.createReadStream(STYLE_REF),
      "style-ref.png",
      { type: "image/png" },
    );
    const t0 = Date.now();
    const response = await openai.images.edit({
      model: "gpt-image-2",
      image: styleFile,
      prompt: buildPrompt(shot),
      size: SIZE,
      quality: QUALITY,
      output_format: "png",
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image data returned for ${shot.id}`);
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    console.log(`[intro] ${shot.id} done in ${dt}s -> ${outPath}`);
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
