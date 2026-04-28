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

  let upstream;
  try {
    upstream = await elevenLabsClient().textToSpeech.streamWithTimestamps(parsed.voiceId, {
      text: parsed.text,
      modelId: MODEL_ID,
      outputFormat: OUTPUT_FORMAT,
    });
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode ?? 500;
    return Response.json(
      { error: "tts_upstream_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of upstream) {
          controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
        }
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: "tts_stream_aborted",
              detail: err instanceof Error ? err.message : String(err),
            }) + "\n",
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
