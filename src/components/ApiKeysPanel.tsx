"use client";

import { useState } from "react";

interface ApiKeysPanelProps {
  onConfirm: (keys: { openaiKey: string; elevenlabsKey: string }) => void;
}

const EyeIcon = ({ visible }: { visible: boolean }) =>
  visible ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );

export default function ApiKeysPanel({ onConfirm }: ApiKeysPanelProps) {
  const [openaiKey, setOpenaiKey] = useState(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("rtsf_openai_key") ?? "")
      : "",
  );
  const [elevenlabsKey, setElevenlabsKey] = useState(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("rtsf_elevenlabs_key") ?? "")
      : "",
  );
  const [showOpenai, setShowOpenai] = useState(false);
  const [showElevenlabs, setShowElevenlabs] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = () => {
    if (!openaiKey.trim() || !elevenlabsKey.trim()) {
      setError("Both keys are required to continue.");
      return;
    }
    setError("");
    localStorage.setItem("rtsf_openai_key", openaiKey.trim());
    localStorage.setItem("rtsf_elevenlabs_key", elevenlabsKey.trim());
    onConfirm({
      openaiKey: openaiKey.trim(),
      elevenlabsKey: elevenlabsKey.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirm();
  };

  const inputClasses =
    "font-sans w-full bg-[var(--color-fog-soft)] rounded-lg px-4 py-3 text-[var(--color-ink)] text-sm placeholder-[var(--color-ink)]/30 focus:outline-none transition-colors pr-11";
  const inputStyle: React.CSSProperties = {
    border: "2px solid var(--color-ink)",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 paper-grain">
      <div
        className="absolute inset-0 halftone pointer-events-none"
        style={{ opacity: 0.14, mixBlendMode: "multiply" }}
      />
      <div
        className="comic-outline animate-bounce-in rounded-2xl p-8 w-full max-w-md relative"
        style={{ background: "var(--color-fog)" }}
      >
        {/* Overline */}
        <p
          className="font-display uppercase font-bold inline-block comic-outline-sm comic-tilt-l rounded-md px-3 py-1 mb-4"
          style={{
            background: "var(--color-mustard)",
            color: "var(--color-ink)",
            fontSize: "0.78rem",
            letterSpacing: "0.18em",
          }}
        >
          Capital for the trip
        </p>

        {/* Title */}
        <h2
          className="font-sans text-[var(--color-ink)] text-2xl font-bold mb-1 leading-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          Card on file, please.
        </h2>

        {/* Subtitle */}
        <p className="font-sans text-[var(--color-ink)]/60 text-sm mb-6 leading-relaxed">
          Stored on your device. Never sent to our servers.
        </p>

        {/* Fields */}
        <div className="flex flex-col gap-4">
          <div>
            <label className="font-display block text-[var(--color-ink)] text-xs uppercase font-bold mb-1.5 tracking-wider">
              OpenAI API Key
            </label>
            <div className="relative">
              <input
                type={showOpenai ? "text" : "password"}
                value={openaiKey}
                onChange={(e) => {
                  setOpenaiKey(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={handleKeyDown}
                placeholder="sk-..."
                className={inputClasses}
                style={inputStyle}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowOpenai((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ink)]/50 hover:text-[var(--color-ink)] transition-colors"
                tabIndex={-1}
                aria-label={showOpenai ? "Hide key" : "Show key"}
              >
                <EyeIcon visible={showOpenai} />
              </button>
            </div>
          </div>

          <div>
            <label className="font-display block text-[var(--color-ink)] text-xs uppercase font-bold mb-1.5 tracking-wider">
              ElevenLabs API Key
            </label>
            <div className="relative">
              <input
                type={showElevenlabs ? "text" : "password"}
                value={elevenlabsKey}
                onChange={(e) => {
                  setElevenlabsKey(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={handleKeyDown}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className={inputClasses}
                style={inputStyle}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowElevenlabs((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ink)]/50 hover:text-[var(--color-ink)] transition-colors"
                tabIndex={-1}
                aria-label={showElevenlabs ? "Hide key" : "Show key"}
              >
                <EyeIcon visible={showElevenlabs} />
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleConfirm}
          className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base mt-6 text-[var(--color-ink)]"
          style={{
            background: "var(--color-sunset)",
            letterSpacing: "-0.005em",
          }}
        >
          Charge card →
        </button>

        {error && (
          <p
            className="font-pixel text-[var(--color-cable)] text-sm mt-3 text-center"
            style={{ letterSpacing: "0.04em" }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
