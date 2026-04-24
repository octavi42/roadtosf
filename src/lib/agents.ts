import type { Archetype } from "./types";

export const ARCHETYPE_KEYS: readonly Archetype[] = [
  "vc",
  "cofounder",
  "reporter",
  "hater",
  "mentor",
] as const;

export const AGENT_ID_ENV_KEYS: Record<Archetype, string> = {
  vc: "ELEVENLABS_AGENT_VC",
  cofounder: "ELEVENLABS_AGENT_COFOUNDER",
  reporter: "ELEVENLABS_AGENT_REPORTER",
  hater: "ELEVENLABS_AGENT_HATER",
  mentor: "ELEVENLABS_AGENT_MENTOR",
};

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPE_KEYS as readonly string[]).includes(value);
}

/**
 * Server-only: resolves the agent ID for an archetype from env.
 * Throws if the env var is missing so misconfiguration fails loudly.
 */
export function getAgentIdForArchetype(archetype: Archetype): string {
  const envKey = AGENT_ID_ENV_KEYS[archetype];
  const id = process.env[envKey];
  if (!id) {
    throw new Error(
      `Missing agent ID for archetype "${archetype}" (env ${envKey})`,
    );
  }
  return id;
}
