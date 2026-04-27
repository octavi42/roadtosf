import OpenAI, { toFile } from "openai";
import { Archetype } from "./types";
import { ARCHETYPES } from "./archetypes";
import path from "path";
import fs from "fs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ImageQuality = "low" | "medium" | "high";
export type ImageFormat = "jpeg" | "png" | "webp";

// Locked presets — never change per call. Define the fixed "look" of every image.
// Size is 1536x1024 (3:2 landscape) — the closest gpt-image-2 preset to 16:9.
// True 16:9 (1792x1024) is dall-e-3 only.
const PRESETS = {
  model: "gpt-image-2" as const,
  size: "1536x1024" as const,
  defaultQuality: "medium" as ImageQuality,
  defaultFormat: "jpeg" as ImageFormat,
  styleRefPath: path.join(process.cwd(), "references", "style-ref.png"),
  portraitsDir: path.join(process.cwd(), "public", "portraits"),
  stylePrefix:
    "Silicon Mania animated series style — flat 2D cel-shaded illustration, thick outlines, saturated palette, exaggerated caricature proportions, Silicon Valley tech satire, cinematic composition with moody lighting.",
};

export interface GenerateSceneImageOptions {
  scenePrompt: string;
  archetype: Archetype;
  quality?: ImageQuality;
  format?: ImageFormat;
}

export interface GenerateHeroImageOptions {
  prompt: string;
  quality?: ImageQuality;
  format?: ImageFormat;
}

export interface ImageResult {
  b64Json: string;
  format: ImageFormat;
  dataUrl: string;
}

async function loadRef(p: string, name: string, type: string) {
  return toFile(fs.createReadStream(p), name, { type });
}

function mustExist(p: string, label: string) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} not found at ${p} — run the reference pipeline first.`);
  }
}

/**
 * Scene generator — double-anchored on style-ref + archetype portrait.
 * Presets are locked; only scenePrompt and archetype vary per call.
 */
export async function generateSceneImage(
  opts: GenerateSceneImageOptions,
): Promise<ImageResult> {
  const {
    scenePrompt,
    archetype,
    quality = PRESETS.defaultQuality,
    format = PRESETS.defaultFormat,
  } = opts;

  const archetypeDef = ARCHETYPES[archetype];
  const portraitPath = path.join(PRESETS.portraitsDir, `${archetype}.png`);

  mustExist(PRESETS.styleRefPath, "style-ref.png");
  mustExist(portraitPath, `portrait for ${archetype}`);

  const [styleFile, portraitFile] = await Promise.all([
    loadRef(PRESETS.styleRefPath, "style-ref.png", "image/png"),
    loadRef(portraitPath, `${archetype}.png`, "image/png"),
  ]);

  const fullPrompt = [
    PRESETS.stylePrefix,
    `Character: ${archetypeDef.name}, ${archetypeDef.title}. ${archetypeDef.imageStyle}.`,
    `Scene: ${scenePrompt}`,
    "Match the art style of the first reference image exactly. Use the second reference image for the character's face and identity.",
  ].join(" ");

  const response = await openai.images.edit({
    model: PRESETS.model,
    image: [styleFile, portraitFile],
    prompt: fullPrompt,
    quality,
    output_format: format,
    size: PRESETS.size,
  });

  const b64Json = response.data?.[0]?.b64_json;
  if (!b64Json) throw new Error("No image data returned from OpenAI images API");
  return {
    b64Json,
    format,
    dataUrl: `data:image/${format};base64,${b64Json}`,
  };
}

/**
 * Run multiple scene generations in parallel.
 * Returns per-item results so one failure doesn't nuke the batch.
 */
export async function generateScenesParallel(
  scenes: GenerateSceneImageOptions[],
): Promise<PromiseSettledResult<ImageResult>[]> {
  return Promise.allSettled(scenes.map((s) => generateSceneImage(s)));
}

/**
 * Hero / share-card generator — style-ref anchored, no character portrait.
 */
export async function generateHeroImage(
  opts: GenerateHeroImageOptions,
): Promise<ImageResult> {
  const {
    prompt,
    quality = "high",
    format = "png",
  } = opts;

  mustExist(PRESETS.styleRefPath, "style-ref.png");
  const styleFile = await loadRef(PRESETS.styleRefPath, "style-ref.png", "image/png");

  const fullPrompt = [
    PRESETS.stylePrefix,
    prompt,
    "Bold, viral, shareable composition. Match the art style of the reference image exactly.",
  ].join(" ");

  const response = await openai.images.edit({
    model: PRESETS.model,
    image: styleFile,
    prompt: fullPrompt,
    quality,
    output_format: format,
    size: PRESETS.size,
  });

  const b64Json = response.data?.[0]?.b64_json;
  if (!b64Json) throw new Error("No image data returned from OpenAI images API");
  return {
    b64Json,
    format,
    dataUrl: `data:image/${format};base64,${b64Json}`,
  };
}
