import OpenAI, { toFile } from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REF_DIR = path.join(ROOT, "references", "silicon-mania");
const OUT_PATH = path.join(ROOT, "references", "style-ref.png");

const DISTILL_PROMPT = [
  "Study the art style of the reference images: line weight, color palette, shading technique, character proportions, rendering quality, and overall aesthetic.",
  "Generate ONE new image of a neutral test character in the EXACT same art style.",
  "Character: a generic young adult in a plain t-shirt, three-quarter view, neutral expression, no logos, plain off-white studio background.",
  "Do not copy any character, pose, or scene from the references — only reproduce the style.",
  "The output must be usable as a canonical style anchor for future generations.",
].join(" ");

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing. Run with: node --env-file=.env.local scripts/distill-style.mjs");
  }

  const entries = fs
    .readdirSync(REF_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();

  if (entries.length === 0) {
    throw new Error(`No reference images found in ${REF_DIR}`);
  }

  console.log(`[distill] using ${entries.length} reference images:`);
  entries.forEach((f) => console.log(`  - ${f}`));

  const files = await Promise.all(
    entries.map((name) => {
      const full = path.join(REF_DIR, name);
      const mime = name.toLowerCase().endsWith(".png")
        ? "image/png"
        : name.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      return toFile(fs.createReadStream(full), name, { type: mime });
    }),
  );

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log("[distill] calling gpt-image-2 edits endpoint...");
  const t0 = Date.now();
  const response = await openai.images.edit({
    model: "gpt-image-2",
    image: files,
    prompt: DISTILL_PROMPT,
    size: "1024x1024",
    quality: "high",
    output_format: "png",
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data returned from OpenAI");

  fs.writeFileSync(OUT_PATH, Buffer.from(b64, "base64"));
  console.log(`[distill] wrote ${OUT_PATH} (${dt}s)`);
}

main().catch((err) => {
  console.error("[distill] failed:", err);
  process.exit(1);
});
