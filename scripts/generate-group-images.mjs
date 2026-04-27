import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STYLE_REF = path.join(ROOT, "references", "style-ref.png");

const QUALITY = process.env.QUALITY ?? "medium";
const SIZE = process.env.SIZE ?? "1536x1024";
const OUT_DIR = path.join(ROOT, "public", "groups");

const NO_CHARACTER_DIRECTIVE =
  "STRICT — do NOT add any central foreground character with a visible face. Any human presence is limited to anonymous silhouettes seen from behind or at a distance. The subject of this frame is the city and the mood, not a person.";

const SHOTS = [
  {
    id: "01-exploring-sf",
    title:
      "the player's first afternoon in San Francisco — alone on a Mission District sidewalk, just dropped off, taking the city in",
    imageStyle:
      "A wide cinematic shot of a Mission District street at golden hour. Victorian rowhouses on the left in flat painted color shapes, telephone poles and tangled overhead wires drawn as clean inked lines, a Caltrain or BART train barely visible in the deep distance behind a chain-link fence. Posters and stylized graffiti on a brick wall in the midground. A single anonymous founder-shaped silhouette with a backpack walking away from camera, drawn small, occupying maybe one tenth of the frame, just left of center. Palm trees frame the right side as graphic stylized shapes. A sliver of bay and bay bridge cables visible at the back of the frame.",
    composition:
      "Wide horizontal cinematic frame, sidewalk leading the eye toward the deep midground, founder silhouette small enough that the city is the subject. Hard one-point perspective.",
    lighting:
      "Strong golden-hour palette — warm orange-amber wash from the right, long cool blue-purple shadows pulling left. Rendered as flat color zones with hard-edged cel shadows. No gradients, no glow, no lens flare.",
    textRule:
      "Allow at most ONE small stylized graffiti tag or poster word on the brick wall. All other text is drawn as abstract squiggles only.",
  },
];

function buildPrompt(shot) {
  const { title, imageStyle, composition, lighting, textRule } = shot;
  return [
    `Hand-drawn establishing frame from a satirical adult-animation TV show: ${title}.`,
    imageStyle,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    textRule,
    NO_CHARACTER_DIRECTIVE,
    "OVERALL STYLE — match the reference frame exactly. Thick hand-inked outlines on EVERYTHING (buildings, vehicles, props, posters, fences). Flat cel-shaded color fills with simple hard-edged shadow shapes. Slight natural variation in line weight that reads as drawn-by-hand. NO photorealism. NO 3D rendering. NO lens blur, depth of field, bokeh, motion blur, or lens flare. NO smooth digital gradients. NO glow or bloom. NO polished Disney/Pixar look. NO soft indie animation feel. NO editorial illustration look. Target is satirical adult-animation TV — chunky, irreverent, atmospheric.",
    "No subtitles, no UI overlays, no watermarks.",
  ].join(" ");
}

async function loadRefs() {
  return [
    await toFile(fs.createReadStream(STYLE_REF), "style-ref.png", {
      type: "image/png",
    }),
  ];
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing. Run with: npm run generate:group-images");
  }
  if (!fs.existsSync(STYLE_REF)) {
    throw new Error(
      `style-ref.png not found at ${STYLE_REF}. Run npm run distill:style first.`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(`[groups] quality=${QUALITY} size=${SIZE} out=${OUT_DIR}`);

  const runOne = async (shot) => {
    const outPath = path.join(OUT_DIR, `${shot.id}.png`);
    const refs = await loadRefs();
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
    console.log(`[groups] ${shot.id} done in ${dt}s -> ${outPath}`);
  };

  const filter = process.env.SHOT;
  const targets = filter ? SHOTS.filter((s) => s.id.includes(filter)) : SHOTS;
  if (filter && targets.length === 0) {
    throw new Error(
      `SHOT="${filter}" matched no shots. Available: ${SHOTS.map((s) => s.id).join(", ")}`,
    );
  }

  const results = await Promise.allSettled(targets.map(runOne));
  const failed = results
    .map((r, i) =>
      r.status === "rejected" ? { shot: targets[i].id, reason: r.reason } : null,
    )
    .filter(Boolean);

  if (failed.length > 0) {
    console.error(`[groups] ${failed.length} failed:`);
    failed.forEach((f) => console.error(`  - ${f.shot}: ${f.reason}`));
    process.exit(1);
  }

  console.log(`[groups] all ${targets.length} shots written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("[groups] failed:", err);
  process.exit(1);
});
