"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import type { ClientTools } from "@elevenlabs/react";

import type { Archetype } from "@/lib/types";

export type TranscriptEntry = {
  id: number;
  role: "user" | "agent";
  text: string;
};

export type VoiceAgentStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "ended"
  | "error";

export type StartOptions = {
  dynamicVariables?: Record<string, string | number | boolean>;
  /**
   * Client tools the agent can invoke mid-conversation. The agent's tool
   * definitions (names + parameter schemas) live in the ElevenLabs dashboard;
   * this is where the browser-side implementation lands.
   */
  clientTools?: ClientTools;
};

export type UseVoiceAgentReturn = {
  status: VoiceAgentStatus;
  transcript: TranscriptEntry[];
  error: string | null;
  isActive: boolean;
  start: (archetype: Archetype, options?: StartOptions) => Promise<void>;
  stop: () => Promise<void>;
};

async function fetchSignedUrl(archetype: Archetype): Promise<string> {
  const res = await fetch(
    `/api/elevenlabs/signed-url?archetype=${encodeURIComponent(archetype)}`,
    { method: "GET", cache: "no-store" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `signed-url request failed (${res.status})`);
  }
  const data = (await res.json()) as { signedUrl: string };
  return data.signedUrl;
}

/**
 * Browser-side wrapper around useConversation. Handles:
 *  - fetching a signed URL from our server
 *  - requesting mic permission (must be triggered from a user gesture)
 *  - starting/ending the session
 *  - exposing a rolling transcript and a compact status enum
 *
 * Must be rendered inside a <ConversationProvider>.
 */
export function useVoiceAgent(): UseVoiceAgentReturn {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected" | "disconnecting"
  >("disconnected");
  const [mode, setMode] = useState<"speaking" | "listening">("listening");
  const [error, setError] = useState<string | null>(null);
  const nextEntryId = useRef(0);

  const conversation = useConversation({
    onConnect: () => {
      setError(null);
    },
    onDisconnect: () => {
      // onStatusChange will follow; no extra work needed here.
    },
    onError: (message) => {
      setError(message);
    },
    onMessage: ({ role, message }) => {
      if (!message) return;
      setTranscript((prev) => [
        ...prev,
        { id: nextEntryId.current++, role, text: message },
      ]);
    },
    onStatusChange: ({ status }) => {
      setConnectionStatus(status);
    },
    onModeChange: ({ mode: nextMode }) => {
      setMode(nextMode);
    },
  });

  const start = useCallback(
    async (archetype: Archetype, options: StartOptions = {}) => {
      setError(null);
      setTranscript([]);
      nextEntryId.current = 0;

      try {
        // Mic permission — must be requested from a user gesture, which is
        // why `start` is meant to be called from onClick.
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Microphone access denied";
        setError(message);
        throw err;
      }

      let signedUrl: string;
      try {
        signedUrl = await fetchSignedUrl(archetype);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch signed URL";
        setError(message);
        throw err;
      }

      conversation.startSession({
        signedUrl,
        connectionType: "websocket",
        dynamicVariables: options.dynamicVariables,
        clientTools: options.clientTools,
      });
    },
    [conversation],
  );

  const stop = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  const status = useMemo<VoiceAgentStatus>(() => {
    if (error) return "error";
    if (connectionStatus === "connecting") return "connecting";
    if (connectionStatus === "disconnecting") return "ended";
    if (connectionStatus === "disconnected") {
      return transcript.length > 0 ? "ended" : "idle";
    }
    return mode === "speaking" ? "speaking" : "listening";
  }, [connectionStatus, mode, error, transcript.length]);

  return {
    status,
    transcript,
    error,
    isActive:
      connectionStatus === "connected" || connectionStatus === "connecting",
    start,
    stop,
  };
}
