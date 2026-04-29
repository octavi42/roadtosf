"use client";

import { useState } from "react";
import DialogueSubtitle from "./DialogueSubtitle";
import DialogueSpeaker from "./DialogueSpeaker";
import { NARRATOR_VOICE_ID } from "@/lib/voices/speaker";

// The narrator's pre-baked opener. Frames the wait as in-world ("you're
// getting your bearings") rather than out-of-world ("the game is loading").
// Pre-bake into public/voices/static via scripts/generate-static-audio.mjs
// to play instantly with zero ElevenLabs cost.
export const NARRATOR_LOBBY_OPENER =
  "You've got a minute before the city gets its hooks in. Anything you want to ask before it does?";

const NARRATOR_SPEAKER = "Narrator";

export interface NarratorLobbyContext {
  startupName?: string;
  startupDescription?: string;
  selfDescription?: string;
  team?: string;
  fundingModel?: string;
  concern?: string;
}

type LinePhase = "speaking" | "idle" | "submitting";

interface NarratorLobbyProps {
  ready: boolean;
  context: NarratorLobbyContext;
  onContinue: () => void;
}

export default function NarratorLobby({
  ready,
  context,
  onContinue,
}: NarratorLobbyProps) {
  const [line, setLine] = useState(NARRATOR_LOBBY_OPENER);
  const [lineKey, setLineKey] = useState(0);
  const [phase, setPhase] = useState<LinePhase>("speaking");
  const [question, setQuestion] = useState("");

  function handleLineComplete() {
    setPhase("idle");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || phase === "submitting") return;
    setQuestion("");
    setPhase("submitting");
    try {
      const resp = await fetch("/api/narrator-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, context }),
      });
      if (!resp.ok) throw new Error(`narrator-ask ${resp.status}`);
      const data = (await resp.json()) as { answer?: string };
      const answer = (data.answer ?? "").trim();
      if (!answer) throw new Error("empty answer");
      setLineKey((n) => n + 1);
      setLine(answer);
      setPhase("speaking");
    } catch (err) {
      console.warn("narrator-ask failed", err);
      // Soft fallback: stay in-world, in-character. Don't surface the error.
      setLineKey((n) => n + 1);
      setLine("That one I can't answer. Ask me something else about the city.");
      setPhase("speaking");
    }
  }

  // Continue is the player's exit. Only show once the line finishes —
  // ready may have flipped mid-answer; we let the answer play out first.
  const showContinue = ready && phase === "idle";
  // Input box hides the moment ready flips, even mid-answer. The Continue
  // button takes over.
  const showInput = !ready && phase === "idle";
  const submitting = phase === "submitting";

  return (
    <div className="w-full max-w-2xl mx-auto px-2 select-none flex flex-col gap-3">
      <DialogueSpeaker speaker={NARRATOR_SPEAKER} />
      <DialogueSubtitle
        key={`narrator-lobby-${lineKey}`}
        text={line}
        wordInterval={110}
        onComplete={handleLineComplete}
        voiceId={NARRATOR_VOICE_ID}
      />

      {showContinue && (
        <button
          onClick={onContinue}
          className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-[var(--color-ink)] animate-bounce-in"
          style={{
            background: "var(--color-sunset)",
            letterSpacing: "-0.005em",
          }}
        >
          Enter the game →
        </button>
      )}

      {showInput && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 animate-bounce-in"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, 280))}
            placeholder="Ask the narrator…"
            className="comic-outline-sm font-sans rounded-xl px-4 py-3 text-base text-[var(--color-ink)] outline-none placeholder-[var(--color-ink)]/40"
            style={{ background: "var(--color-fog)" }}
          />
          <button
            type="submit"
            disabled={!question.trim()}
            className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-[var(--color-ink)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "var(--color-mustard)",
              letterSpacing: "-0.005em",
            }}
          >
            Ask →
          </button>
        </form>
      )}

      {submitting && (
        <div className="flex justify-center gap-1.5 pt-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full"
              style={{
                background: "var(--color-ink)",
                opacity: 0.5,
                animation: "pulse 1.6s ease-in-out infinite",
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
