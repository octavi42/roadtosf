"use client";

import { useState } from "react";

interface ApiKeysPanelProps {
  onConfirm: (keys: { openaiKey: string; elevenlabsKey: string }) => void;
}

const EyeIcon = ({ visible }: { visible: boolean }) =>
  visible ? (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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

  return (
    <div className="backdrop-panel animate-fade-slide-up rounded-2xl p-8 w-full max-w-md">
        {/* Overline */}
        <p className="text-amber-400 text-xs font-semibold tracking-widest uppercase mb-4">
          Capital for the trip
        </p>

        {/* Title */}
        <h2 className="text-white text-xl font-semibold mb-1">
          Card on file, please
        </h2>

        {/* Subtitle */}
        <p className="text-white/40 text-sm mb-6">
          Stored on your device. Never sent to our servers.
        </p>

        {/* Fields */}
        <div className="flex flex-col gap-4">
          {/* OpenAI Key */}
          <div>
            <label className="block text-white/60 text-xs mb-1">
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
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/30 transition-colors pr-11"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowOpenai((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                tabIndex={-1}
                aria-label={showOpenai ? "Hide key" : "Show key"}
              >
                <EyeIcon visible={showOpenai} />
              </button>
            </div>
          </div>

          {/* ElevenLabs Key */}
          <div>
            <label className="block text-white/60 text-xs mb-1">
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
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/30 transition-colors pr-11"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowElevenlabs((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                tabIndex={-1}
                aria-label={showElevenlabs ? "Hide key" : "Show key"}
              >
                <EyeIcon visible={showElevenlabs} />
              </button>
            </div>
          </div>
        </div>

        {/* Confirm button */}
        <button
          type="button"
          onClick={handleConfirm}
          className="w-full bg-white text-black font-semibold rounded-lg py-3 hover:bg-white/90 transition-colors mt-6"
        >
          Charge card →
        </button>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-xs mt-2 text-center">{error}</p>
        )}
      </div>
  );
}
