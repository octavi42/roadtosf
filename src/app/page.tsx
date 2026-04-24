"use client";

import { useState, useCallback, useEffect } from "react";
import { GameShell } from "@/components/GameShell";
import ApiKeysPanel from "@/components/ApiKeysPanel";
import MuteButton from "@/components/MuteButton";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase =
  | "api-keys" // Player enters API keys
  | "intro" // Cinematic intro / conversational onboarding
  | "generating" // Story arc being generated (LLM call #1)
  | "scene" // Active game scene
  | "ending"; // Final ending + share card

interface ApiKeys {
  openaiKey: string;
  elevenlabsKey: string;
}

// Stub choices for layout preview — will be replaced by real scene data
const STUB_CHOICES = [
  { id: "a", label: "No, ship the original" },
  { id: "b", label: "Yes, pivot now" },
  { id: "timeout", label: "…" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("api-keys");
  const [apiKeys, setApiKeys] = useState<ApiKeys | null>(null);

  // In development, skip the ApiKeysPanel if keys are already in .env.local
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    fetch("/api/dev-keys")
      .then((r) => r.json())
      .then((data: { skip: boolean }) => {
        if (data.skip) setPhase("intro");
      })
      .catch(() => {
        // silently fall through — ApiKeysPanel will show as normal
      });
  }, []);

  const [isMuted, setIsMuted] = useState(false);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [choiceMade, setChoiceMade] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleKeysConfirmed = useCallback((keys: ApiKeys) => {
    setApiKeys(keys); // stored for passing to API calls
    setPhase("intro");
  }, []);

  const handleMuteToggle = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const handleChoice = useCallback((id: string) => {
    setChoiceMade(id);
    // TODO: apply stat delta, advance to next scene
    console.log("[choice]", id);
  }, []);

  const handleTextSubmit = useCallback((text: string) => {
    // TODO: send to LLM for Scene 3 counter-offer classification
    console.log("[text-input]", text);
  }, []);

  // -------------------------------------------------------------------------
  // Derived UI slots
  // -------------------------------------------------------------------------

  const muteButton = (
    <MuteButton isMuted={isMuted} onToggle={handleMuteToggle} />
  );

  // Bottom panel: show choice buttons or text input depending on mute + phase
  const bottomPanel = (() => {
    if (phase !== "scene") return null;

    if (isMuted) {
      return (
        <div className="px-4 pb-6">
          <TextInputPanel
            placeholder="Type your response…"
            onSubmit={handleTextSubmit}
            disabled={choiceMade !== null}
          />
        </div>
      );
    }

    return (
      <div className="px-4 pb-6">
        <ChoicePanel
          choices={STUB_CHOICES}
          timeoutSeconds={15}
          onChoice={handleChoice}
          disabled={choiceMade !== null}
        />
      </div>
    );
  })();

  // -------------------------------------------------------------------------
  // Center content by phase
  // -------------------------------------------------------------------------

  const centerContent = (() => {
    switch (phase) {
      case "api-keys":
        // ApiKeysPanel renders itself as a fixed overlay — center slot is empty
        return null;

      case "intro":
        return (
          <div className="backdrop-panel animate-fade-slide-up rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-4">
            <p className="text-amber-400 text-xs font-semibold tracking-widest uppercase">
              SFO → Your Future
            </p>
            <h1 className="text-white text-2xl font-semibold leading-snug">
              Your flight to SFO
              <br />
              departs in 6 hours.
            </h1>
            <p className="text-white/50 text-sm leading-relaxed">
              Tell me about your startup. What are you building, and who are
              you?
            </p>
            {/* TODO: wire ElevenLabs voice agent (mentor archetype) here */}
            <button
              onClick={() => setPhase("generating")}
              className="mt-2 w-full bg-white text-black font-semibold rounded-lg py-3 hover:bg-white/90 transition-colors text-sm"
            >
              Skip to demo scene →
            </button>
          </div>
        );

      case "generating":
        return (
          <div className="backdrop-panel animate-fade-slide-up rounded-2xl p-8 max-w-sm w-full text-center flex flex-col gap-3">
            <div className="flex justify-center gap-1.5 mb-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-white/40 animate-pulse"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
            <p className="text-white/60 text-sm leading-relaxed">
              You just landed at SFO.
              <br />
              Your co-founder is already texting.
            </p>
            {/* TODO: trigger story arc generation, then transition to "scene" */}
            <button
              onClick={() => {
                setBackgroundSrc(null); // will be set to generated image URL
                setPhase("scene");
                setChoiceMade(null);
              }}
              className="mt-4 text-white/30 hover:text-white/60 text-xs underline transition-colors"
            >
              Skip (dev)
            </button>
          </div>
        );

      case "scene":
        return (
          <div className="backdrop-panel animate-fade-slide-up rounded-2xl px-6 py-5 max-w-lg w-full flex flex-col gap-3">
            {/* Scene label */}
            <p className="text-amber-400 text-xs font-semibold tracking-widest uppercase">
              Scene 1 · The Pivot
            </p>
            {/* Dialogue stub */}
            <p className="text-white text-base leading-relaxed">
              &ldquo;We have to pivot. The market shifted overnight and if we
              don&apos;t move now, Brock&apos;s team will eat our lunch before
              we even launch.&rdquo;
            </p>
            <p className="text-white/40 text-xs">— Maya, Co-founder & CTO</p>
            {choiceMade && (
              <p className="text-white/50 text-xs mt-1 italic">
                You chose: <span className="text-white/70">{choiceMade}</span>
              </p>
            )}
          </div>
        );

      case "ending":
        return (
          <div className="backdrop-panel animate-fade-slide-up rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-4">
            <p className="text-amber-400 text-xs font-semibold tracking-widest uppercase">
              Your ending
            </p>
            <h2 className="text-white text-3xl font-bold tracking-tight">
              GHOSTED
            </h2>
            <p className="text-white/60 text-sm leading-relaxed">
              You never quite registered. The algorithm didn&apos;t notice.
              Neither did anyone else.
            </p>
          </div>
        );
    }
  })();

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      {/* API keys overlay — rendered outside GameShell so it sits above everything */}
      {phase === "api-keys" && <ApiKeysPanel onConfirm={handleKeysConfirmed} />}

      <GameShell
        backgroundSrc={backgroundSrc}
        muteButton={muteButton}
        bottomPanel={bottomPanel}
      >
        {centerContent}
      </GameShell>
    </>
  );
}
