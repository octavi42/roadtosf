"use client";

import { useState } from "react";

interface OnboardingPanelProps {
  onSubmit: (transcript: string) => void;
}

type Mode = "text" | "voice";

export default function OnboardingPanel({ onSubmit }: OnboardingPanelProps) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);

  const canSubmit =
    mode === "text" ? text.trim().length > 0 : true;

  const handleSubmit = () => {
    onSubmit(text);
  };

  return (
    <div className="backdrop-panel animate-fade-slide-up rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4">
      <p className="text-white/40 text-xs text-center tracking-wide">
        What are you building? Why this? Why you?
      </p>

      <div
        role="tablist"
        aria-label="Input mode"
        className="flex gap-1 p-1 bg-white/5 rounded-lg border border-white/10 mx-auto"
      >
        <ModeTab
          label="Type"
          active={mode === "text"}
          onClick={() => setMode("text")}
        />
        <ModeTab
          label="Speak"
          active={mode === "voice"}
          onClick={() => setMode("voice")}
        />
      </div>

      {mode === "text" ? (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
              handleSubmit();
            }
          }}
          placeholder="The startup. The people you admire. The ones you're scared of. The one shot you've got…"
          rows={6}
          className="w-full bg-white/5 border border-white/10 rounded-lg p-4 text-white text-sm leading-relaxed placeholder:text-white/30 resize-none focus:outline-none focus:border-white/30 transition-colors"
        />
      ) : (
        <VoiceInput
          isRecording={isRecording}
          onToggle={() => setIsRecording((r) => !r)}
        />
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full bg-white text-black font-semibold rounded-lg py-3 hover:bg-white/90 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Buy your ticket →
      </button>

      {mode === "text" && (
        <p className="text-white/30 text-[11px] text-center -mt-2">
          ⌘ + Enter to submit
        </p>
      )}
    </div>
  );
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-5 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active
          ? "bg-white text-black"
          : "text-white/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function VoiceInput({
  isRecording,
  onToggle,
}: {
  isRecording: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <button
        onClick={onToggle}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all ${
          isRecording
            ? "bg-red-500/15 border-2 border-red-500/60"
            : "bg-white/5 border-2 border-white/20 hover:border-white/40"
        }`}
      >
        {isRecording && (
          <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
        )}
        <MicIcon active={isRecording} />
      </button>
      <p
        className={`text-xs font-medium tracking-wide ${
          isRecording ? "text-red-300/90" : "text-white/50"
        }`}
      >
        {isRecording ? "Listening…" : "Tap to speak"}
      </p>
      <div className="w-full min-h-[5rem] bg-white/5 border border-white/10 rounded-lg p-3 text-sm">
        <span className="text-white/30 italic">
          Your words appear here as you speak…
        </span>
      </div>
    </div>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "rgb(252 165 165)" : "rgba(255,255,255,0.85)"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}
