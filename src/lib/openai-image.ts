import OpenAI, { toFile } from "openai";
import { Archetype } from "./types";
import { ARCHETYPES } from "./archetypes";
import path from "path";
import fs from "fs";

// Only instantiate on the server
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ImageQuality = "low" | "medium" | "high";
export type ImageFormat = "jpeg" | "png" | "webp";

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
  dataUrl: string; // convenience: `data:image/jpeg;base64,...`
}

/**
 * Generate a scene image using gpt-image-2 edit endpoint.
 * Passes the archetype's locked reference portrait to maintain
 * character consistency across all scenes.
 */
export async function generateSceneImage(
  opts: GenerateSceneImageOptions,
): Promise<ImageResult> {
  const { scenePrompt, archetype, quality = "medium", format = "jpeg" } = opts;

  const archetypeDef = ARCHETYPES[archetype];

  // Build the full prompt with archetype visual style appended
  const fullPrompt = [
    scenePrompt,
    `The character is ${archetypeDef.name}, ${archetypeDef.title}.`,
    `Visual style: ${archetypeDef.imageStyle}.`,
    "Cinematic composition. Silicon Valley tech satire aesthetic. Rich, moody lighting.",
    "Semi-realistic digital illustration style. High detail.",
  ].join(" ");

  // Load the reference portrait from the public directory
  const portraitPath = path.join(
    process.cwd(),
    "public",
    "portraits",
    `${archetype}.png`,
  );
  const portraitExists = fs.existsSync(portraitPath);

  let response:
    | Awaited<ReturnType<typeof openai.images.edit>>
    | Awaited<ReturnType<typeof openai.images.generate>>;

  if (portraitExists) {
    // Use edit endpoint with reference portrait for character consistency
    const portraitFile = await toFile(
      fs.createReadStream(portraitPath),
      `${archetype}.png`,
      { type: "image/png" },
    );

    response = await openai.images.edit({
      model: "gpt-image-2",
      image: portraitFile,
      prompt: fullPrompt,
      quality,
      output_format: format,
      size: "1024x1024",
    });
  } else {
    // Fallback: generate without reference (no portrait seeded yet)
    response = await openai.images.generate({
      model: "gpt-image-2",
      prompt: fullPrompt,
      quality,
      output_format: format,
      size: "1024x1024",
    });
  }

  const b64Json = (response.data ?? [])[0]?.b64_json;
  if (!b64Json)
    throw new Error("No image data returned from OpenAI images API");
  return {
    b64Json,
    format,
    dataUrl: `data:image/${format};base64,${b64Json}`,
  };
}

/**
 * Generate the final share card hero image using gpt-image-2 generate endpoint.
 * This is a full text-to-image call — no reference portrait needed.
 */
export async function generateHeroImage(
  opts: GenerateHeroImageOptions,
): Promise<ImageResult> {
  const { prompt, quality = "high", format = "png" } = opts;

  const fullPrompt = [
    prompt,
    "Cinematic, highly detailed digital illustration.",
    "Silicon Valley tech satire aesthetic.",
    "Bold, viral, shareable composition.",
    "Rich colors, dramatic lighting.",
  ].join(" ");

  const response = await openai.images.generate({
    model: "gpt-image-2",
    prompt: fullPrompt,
    quality,
    output_format: format,
    size: "1024x1024",
  });

  const b64Json = (response.data ?? [])[0]?.b64_json;
  if (!b64Json)
    throw new Error("No image data returned from OpenAI images API");
  return {
    b64Json,
    format,
    dataUrl: `data:image/${format};base64,${b64Json}`,
  };
}
