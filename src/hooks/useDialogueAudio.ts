"use client";

import { useEffect, useState } from "react";

import {
  STATIC_AUDIO_MANIFEST,
  staticAudioKey,
} from "@/lib/static-audio-manifest";

interface AlignmentResponse {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

interface TtsResponse {
  audioBase64?: string;
  alignment?: AlignmentResponse | null;
  error?: string;
}

export type DialogueAudioStatus = "idle" | "fetching" | "ready" | "error";

export interface UseDialogueAudioInput {
  voiceId: string | null | undefined;
  text: string;
  enabled?: boolean;
}

export interface UseDialogueAudioResult {
  audioUrl: string | null;
  wordStartsMs: number[] | null;
  status: DialogueAudioStatus;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Walk text words against the alignment characters; whitespace in alignment
// is skipped, then the start time of each word's first char becomes that
// word's reveal point. Robust to punctuation drift between text and
// alignment.
function computeWordStarts(
  text: string,
  charSequence: string[],
  charStartsSeconds: number[],
): number[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const result: number[] = [];
  let charIdx = 0;
  for (const word of words) {
    while (charIdx < charSequence.length && /\s/.test(charSequence[charIdx])) {
      charIdx++;
    }
    if (charIdx >= charSequence.length) {
      result.push(result[result.length - 1] ?? 0);
      continue;
    }
    result.push(charStartsSeconds[charIdx] * 1000);
    charIdx += word.length;
  }
  return result;
}

export function useDialogueAudio({
  voiceId,
  text,
  enabled = true,
}: UseDialogueAudioInput): UseDialogueAudioResult {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [wordStartsMs, setWordStartsMs] = useState<number[] | null>(null);
  const [status, setStatus] = useState<DialogueAudioStatus>("idle");

  useEffect(() => {
    if (!enabled || !voiceId || !text) {
      setStatus("idle");
      return;
    }

    let canceled = false;
    const ac = new AbortController();

    setStatus("fetching");

    // Check if this (voiceId, text) tuple was pre-generated. If yes, fetch
    // the static audio + alignment from /public — zero ElevenLabs cost,
    // sub-50ms latency. Falls through to live TTS only on fetch failure
    // (stale manifest, file missing, network blip).
    const staticEntry = STATIC_AUDIO_MANIFEST[staticAudioKey(voiceId, text)];

    (async () => {
      if (staticEntry) {
        try {
          const [audioResp, alignResp] = await Promise.all([
            fetch(staticEntry.audioUrl, { signal: ac.signal }),
            fetch(staticEntry.alignmentUrl, { signal: ac.signal }),
          ]);
          if (!audioResp.ok) throw new Error(`static audio ${audioResp.status}`);
          if (!alignResp.ok) throw new Error(`static align ${alignResp.status}`);
          const audioBlob = await audioResp.blob();
          const alignment = (await alignResp.json()) as AlignmentResponse;
          if (canceled) return;
          setAudioUrl(URL.createObjectURL(audioBlob));
          setWordStartsMs(
            computeWordStarts(
              text,
              alignment.characters,
              alignment.characterStartTimesSeconds,
            ),
          );
          setStatus("ready");
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          // Static fetch failed — fall through to live TTS instead of
          // erroring out, so a stale manifest never blocks playback.
          if (canceled) return;
          console.warn(
            "static audio fetch failed; falling back to /api/tts",
            err,
          );
        }
      }

      try {
        const resp = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voiceId, text }),
          signal: ac.signal,
        });
        if (!resp.ok) {
          throw new Error(`tts http ${resp.status}`);
        }
        const data = (await resp.json()) as TtsResponse;
        if (canceled) return;
        if (data.error || !data.audioBase64) {
          throw new Error(data.error ?? "tts empty response");
        }
        const bytes = base64ToBytes(data.audioBase64);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        if (data.alignment) {
          setWordStartsMs(
            computeWordStarts(
              text,
              data.alignment.characters,
              data.alignment.characterStartTimesSeconds,
            ),
          );
        }
        setStatus("ready");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!canceled) setStatus("error");
      }
    })();

    // Deliberately do not URL.revokeObjectURL here — Safari/Chrome may stop
    // the underlying <audio> element when its src blob is invalidated, even
    // if the cleanup runs from an unrelated parent re-render. We accept the
    // tiny per-line memory leak; the browser frees blobs on tab close.
    return () => {
      canceled = true;
      ac.abort();
      setAudioUrl(null);
      setWordStartsMs(null);
    };
  }, [voiceId, text, enabled]);

  return { audioUrl, wordStartsMs, status };
}
