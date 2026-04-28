import "server-only";
import { NextRequest } from "next/server";
import { z } from "zod";

import { elevenLabsClient } from "@/lib/elevenlabs-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ttsBodySchema = z.object({
  voiceId: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
});

const MODEL_ID = "eleven_flash_v2_5";
const OUTPUT_FORMAT = "mp3_44100_128";

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof ttsBodySchema>;
  try {
    parsed = ttsBodySchema.parse(await req.json());
  } catch (err) {
    return Response.json(
      { error: "invalid_body", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  try {
    const result = await elevenLabsClient().textToSpeech.convertWithTimestamps(
      parsed.voiceId,
      {
        text: parsed.text,
        modelId: MODEL_ID,
        outputFormat: OUTPUT_FORMAT,
      },
    );
    return Response.json({
      audioBase64: result.audioBase64,
      alignment: result.alignment ?? null,
    });
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode ?? 500;
    return Response.json(
      { error: "tts_upstream_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}
