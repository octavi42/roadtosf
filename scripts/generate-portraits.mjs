import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STYLE_REF = path.join(ROOT, "references", "style-ref.png");
const QUALITY = process.env.QUALITY ?? "medium";
const OUT_DIR =
  QUALITY === "medium"
    ? path.join(ROOT, "public", "portraits")
    : path.join(ROOT, "public", `portraits-${QUALITY}`);

const ARCHETYPES = [
  {
    id: "vc",
    name: "Victor",
    title: "Managing Partner at a top-tier VC firm",
    imageStyle:
      "older man, wearing a perfectly tailored dark blazer, sharp jawline, cold blue eyes, minimalist office background",
  },
  {
    id: "cofounder",
    name: "Maya",
    title: "Co-founder and CTO of a startup",
    imageStyle:
      "young woman, wearing a hoodie, dark circles under bright eyes, messy bun, laptop stickers visible, co-working space background",
  },
  {
    id: "reporter",
    name: "Chad",
    title: "Senior tech reporter",
    imageStyle:
      "young man, wearing a slim-fit button-down, notebook in hand, smirking, coffee shop background with exposed brick",
  },
  {
    id: "hater",
    name: "Brock",
    title: "CEO of a competing startup",
    imageStyle:
      "young man, wearing an expensive streetwear hoodie, arms crossed, perfect stubble, rooftop bar background at golden hour",
  },
  {
    id: "mentor",
    name: "Sandra",
    title: "Startup accelerator partner emeritus",
    imageStyle:
      "older woman, wearing smart casual attire, reading glasses pushed up, warm smile that doesn't quite reach the eyes, sunlit office background",
  },
];

function buildPrompt({ name, title, imageStyle }) {
  return [
    `Canonical character portrait of ${name}, ${title}.`,
    `Visual details: ${imageStyle}.`,
    "Three-quarter view, head and shoulders, facing camera, neutral-to-confident expression.",
    "EXACT same art style as the reference image: line weight, color palette, shading technique, character proportions, rendering quality.",
    "This is a clean canonical character reference — well-lit, no scene clutter, no text.",
  ].join(" ");
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing. Run with: npm run generate:portraits");
  }
  if (!fs.existsSync(STYLE_REF)) {
    throw new Error(`style-ref.png not found at ${STYLE_REF}. Run npm run distill:style first.`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(`[portrait] quality=${QUALITY} out=${OUT_DIR}`);

  const runOne = async (arch) => {
    const outPath = path.join(OUT_DIR, `${arch.id}.png`);
    const styleFile = await toFile(
      fs.createReadStream(STYLE_REF),
      "style-ref.png",
      { type: "image/png" },
    );
    const t0 = Date.now();
    const response = await openai.images.edit({
      model: "gpt-image-2",
      image: styleFile,
      prompt: buildPrompt(arch),
      size: "1024x1024",
      quality: QUALITY,
      output_format: "png",
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image data returned for ${arch.id}`);
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    console.log(`[portrait] ${arch.id} (${arch.name}) done in ${dt}s -> ${outPath}`);
  };

  const results = await Promise.allSettled(ARCHETYPES.map(runOne));
  const failed = results
    .map((r, i) => (r.status === "rejected" ? { arch: ARCHETYPES[i].id, reason: r.reason } : null))
    .filter(Boolean);

  if (failed.length > 0) {
    console.error(`[portrait] ${failed.length} failed:`);
    failed.forEach((f) => console.error(`  - ${f.arch}: ${f.reason}`));
    process.exit(1);
  }

  console.log(`[portrait] all ${ARCHETYPES.length} portraits written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("[portrait] failed:", err);
  process.exit(1);
});
