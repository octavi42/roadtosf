"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { GameShell } from "@/components/GameShell";
import ApiKeysPanel from "@/components/ApiKeysPanel";
import MuteButton from "@/components/MuteButton";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";
import DialogueSubtitle from "@/components/DialogueSubtitle";

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

interface DialogueLine {
  speaker: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Stub data — replaced by real LLM output later
// ---------------------------------------------------------------------------

const STUB_DIALOGUE: DialogueLine[] = [
  {
    speaker: "Maya · Co-founder & CTO",
    text: "We have to pivot. The market shifted overnight.",
  },
  {
    speaker: "Maya · Co-founder & CTO",
    text: "If we don't move now, Brock's team will eat our lunch before we even launch.",
  },
  {
    speaker: "Maya · Co-founder & CTO",
    text: "I need you to back me on this. Right now.",
  },
];

const STUB_CHOICES = [
  { id: "a", label: "No, ship the original" },
  { id: "b", label: "Yes, pivot now" },
  { id: "c", label: "Give me 24 hours" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("api-keys");
  const [apiKeys, setApiKeys] = useState<ApiKeys | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [backgroundSrc] = useState<string | null>(
    "/intro-v2/01-departure-board.png",
  );
  const [choiceMade, setChoiceMade] = useState<string | null>(null);

  // Dialogue state
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [showChoices, setShowChoices] = useState(false);
  const onCompleteCalledRef = useRef(false);

  // -------------------------------------------------------------------------
  // Dev: skip API key panel when .env.local keys are present
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    fetch("/api/dev-keys")
      .then((r) => r.json())
      .then((data: { skip: boolean }) => {
        if (data.skip) setPhase("intro");
      })
      .catch(() => {
        // fall through — ApiKeysPanel shows normally
      });
  }, []);

  // -------------------------------------------------------------------------
  // Scene init — load dialogue lines, reset state
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== "scene") return;
    setDialogueLines(STUB_DIALOGUE);
    setCurrentLineIndex(0);
    setShowChoices(false);
    setChoiceMade(null);
    onCompleteCalledRef.current = false;
  }, [phase]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleKeysConfirmed = useCallback((keys: ApiKeys) => {
    setApiKeys(keys);
    setPhase("intro");
  }, []);

  const handleMuteToggle = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const handleChoice = useCallback((id: string) => {
    setChoiceMade(id);
    console.log("[choice]", id);
  }, []);

  const handleTextSubmit = useCallback((text: string) => {
    console.log("[text-input]", text);
  }, []);

  // Called when each dialogue line finishes animating
  const handleLineComplete = useCallback(() => {
    if (onCompleteCalledRef.current) return;

    setCurrentLineIndex((prev) => {
      const next = prev + 1;
      if (next >= dialogueLines.length) {
        // All lines done — DialogueSubtitle has already faded out by the time
        // onComplete fires, so show choices immediately with no extra delay.
        onCompleteCalledRef.current = true;
        setShowChoices(true);
        return prev;
      }
      return next;
    });
  }, [dialogueLines.length]);

  // -------------------------------------------------------------------------
  // Derived slots
  // -------------------------------------------------------------------------

  const muteButton = (
    <MuteButton isMuted={isMuted} onToggle={handleMuteToggle} />
  );

  const currentLine = dialogueLines[currentLineIndex] ?? null;

  const dialogueSlot =
    phase === "scene" && currentLine ? (
      <DialogueSubtitle
        key={`${currentLineIndex}-${currentLine.text}`}
        text={currentLine.text}
        speaker={currentLine.speaker}
        wordInterval={110}
        onComplete={handleLineComplete}
      />
    ) : null;

  const bottomPanel = (() => {
    if (phase !== "scene" || !showChoices) return null;

    if (isMuted) {
      return (
        <TextInputPanel
          placeholder="Type your response…"
          onSubmit={handleTextSubmit}
          disabled={choiceMade !== null}
        />
      );
    }

    return (
      <ChoicePanel
        choices={STUB_CHOICES}
        timeoutSeconds={15}
        onChoice={handleChoice}
        disabled={choiceMade !== null}
      />
    );
  })();

  // -------------------------------------------------------------------------
  // Center content by phase
  // -------------------------------------------------------------------------

  const centerContent = (() => {
    switch (phase) {
      case "api-keys":
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
            <button
              onClick={() => setPhase("scene")}
              className="mt-4 text-white/30 hover:text-white/60 text-xs underline transition-colors"
            >
              Skip (dev)
            </button>
          </div>
        );

      case "scene":
        // Scene label pinned top-left — dialogue + choices live at the bottom
        return (
          <div className="absolute top-16 left-6">
            <p
              className="text-white/30 text-xs font-semibold tracking-widest uppercase"
              style={{ letterSpacing: "0.18em" }}
            >
              Scene 1 · The Pivot
            </p>
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
      {phase === "api-keys" && <ApiKeysPanel onConfirm={handleKeysConfirmed} />}

      <GameShell
        backgroundSrc={backgroundSrc}
        muteButton={muteButton}
        dialogueSlot={dialogueSlot}
        bottomPanel={bottomPanel}
      >
        {centerContent}
      </GameShell>
    </>
  );
}
