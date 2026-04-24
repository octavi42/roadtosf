import "server-only";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import { getAgentIdForArchetype } from "./agents";
import type { Archetype } from "./types";

let cached: ElevenLabsClient | null = null;

function client(): ElevenLabsClient {
  if (cached) return cached;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }
  cached = new ElevenLabsClient({ apiKey });
  return cached;
}

export async function getSignedUrlForArchetype(
  archetype: Archetype,
): Promise<string> {
  const agentId = getAgentIdForArchetype(archetype);
  const response = await client().conversationalAi.conversations.getSignedUrl({
    agentId,
  });
  return response.signedUrl;
}
