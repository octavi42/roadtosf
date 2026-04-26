"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { GameShell } from "@/components/GameShell";
import ApiKeysPanel from "@/components/ApiKeysPanel";
import MuteButton from "@/components/MuteButton";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";
import DialogueSubtitle from "@/components/DialogueSubtitle";
import DialogueSpeaker from "@/components/DialogueSpeaker";
import { useSessionStore } from "@/lib/session";
import type { EndingKey } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeys {
  openaiKey: string;
  elevenlabsKey: string;
}

interface DialogueLine {
  speaker: string;
  text: string;
}

interface Choice {
  id: string;
  label: string;
  hype: number;
  integrity: number;
}

interface SceneData {
  id: number;
  title: string;
  dialogue: DialogueLine[];
  choices: Choice[];
}

// ---------------------------------------------------------------------------
// Prescripted story — Wagr (Venmo for sports bets between friends)
// ---------------------------------------------------------------------------

const SCENES: SceneData[] = [
  {
    id: 1,
    title: "Scene 1 · The Pivot",
    dialogue: [
      {
        speaker: "Maya · Co-founder & CTO",
        text: "We need to talk before the pitch. I've been thinking — Wagr needs to pivot to AI.",
      },
      {
        speaker: "Maya · Co-founder & CTO",
        text: "Everyone on Sand Hill is asking about AI agents. Peer-to-peer betting is a tough sell right now.",
      },
      {
        speaker: "Maya · Co-founder & CTO",
        text: "We wrap Wagr in an AI layer — 'your AI friend who handles all your bets' — and suddenly we're a platform play.",
      },
      {
        speaker: "Maya · Co-founder & CTO",
        text: "I can have a demo ready by Thursday. But I need you to back me on this. Right now.",
      },
    ],
    choices: [
      { id: "a", label: "No, ship the original", hype: -1, integrity: 1 },
      { id: "b", label: "Yes, pivot to AI", hype: 1, integrity: -1 },
    ],
  },
  {
    id: 2,
    title: "Scene 2 · The Scoop",
    dialogue: [
      {
        speaker: "Journalist · TechCrunch",
        text: "I heard from three sources that Wagr's payment processor dropped you over regulatory concerns. Care to comment?",
      },
      {
        speaker: "Journalist · TechCrunch",
        text: "I'm running this either way. The question is whether your version of the story is in it.",
      },
      {
        speaker: "Journalist · TechCrunch",
        text: "Off the record — I actually think what you're building is interesting. But my editor wants blood.",
      },
      {
        speaker: "Journalist · TechCrunch",
        text: "Give me something. Anything. A leak, a number, a name. I'll make it worth your while.",
      },
    ],
    choices: [
      {
        id: "a",
        label: "That's not true. No comment.",
        hype: -1,
        integrity: 1,
      },
      { id: "b", label: "Send her the details", hype: 1, integrity: -1 },
    ],
  },
  {
    id: 3,
    title: "Scene 3 · The Term Sheet",
    dialogue: [
      {
        speaker: "VC · Founders Fund",
        text: "Tell me something that's true that almost nobody agrees with you on.",
      },
      {
        speaker: "VC · Founders Fund",
        text: "We want to lead your seed. Three million, fifteen percent, standard pro-rata.",
      },
      {
        speaker: "VC · Founders Fund",
        text: "One condition. Maya steps back to an advisory role. We want you running point, solo.",
      },
      {
        speaker: "VC · Founders Fund",
        text: "This offer expires when I leave this table. The Caltrain back to the city is in eleven minutes.",
      },
    ],
    choices: [
      { id: "a", label: "Take it", hype: 1, integrity: -1 },
      { id: "b", label: "Walk away", hype: -1, integrity: 1 },
    ],
  },
  {
    id: 4,
    title: "Scene 4 · Trust Crisis",
    dialogue: [
      {
        speaker: "Maya · Co-founder & CTO",
        text: "I saw the term sheet. The one with my name in the advisory clause.",
      },
      {
        speaker: "Maya · Co-founder & CTO",
        text: "You were going to tell me when, exactly?",
      },
      {
        speaker: "Hater · Twitter / X",
        text: "Wagr founder just pushed out his CTO for VC money. Classic. Thread incoming 🧵",
      },
      {
        speaker: "Maya · Co-founder & CTO",
        text: "I built the entire backend. I have thirty percent. Whatever you're about to say — think carefully.",
      },
    ],
    choices: [
      { id: "a", label: "Lie. You never saw it.", hype: 0, integrity: -2 },
      { id: "b", label: "Level with her", hype: 0, integrity: 2 },
    ],
  },
  {
    id: 5,
    title: "Scene 5 · Demo Day",
    dialogue: [
      {
        speaker: "Mentor · YC Partner",
        text: "You're on in ten minutes. Five hundred people in that room, half of them writing checks.",
      },
      {
        speaker: "Mentor · YC Partner",
        text: "The number they remember is the one you say on stage. It lives forever.",
      },
      {
        speaker: "Mentor · YC Partner",
        text: "Your actual MRR is eighty thousand. That's real. That's respectable.",
      },
      {
        speaker: "Mentor · YC Partner",
        text: "But I've seen founders say ten million ARR with a straight face and walk out with a term sheet. Your call.",
      },
    ],
    choices: [
      { id: "a", label: "Understated truth", hype: -1, integrity: 2 },
      { id: "b", label: "Full hype. $10M ARR.", hype: 2, integrity: -2 },
    ],
  },
];

const ENDING_COPY: Record<
  EndingKey,
  { label: string; subtitle: string; color: string }
> = {
  ipo: {
    label: "IPO",
    subtitle:
      "Wagr rang the bell at NYSE on a Tuesday. You cried. Maya didn't come. The Bloomberg headline called you 'the unlikely conscience of fintech.' You framed it.",
    color: "text-emerald-400",
  },
  indicted: {
    label: "INDICTED",
    subtitle:
      "The SEC opened an inquiry in November. You're on your third podcast apology tour. Wagr pivoted to compliance software. It still has twelve employees.",
    color: "text-red-400",
  },
  "ai-wrapper": {
    label: "AI-WRAPPER PIVOT",
    subtitle:
      "You quietly rebranded to WagrAI, laid off four people, and wrote a Substack post called 'Why We're Going Back to Basics.' It got three thousand likes.",
    color: "text-sky-400",
  },
  acquihire: {
    label: "ACQUI-HIRED",
    subtitle:
      "DraftKings bought the team for parts. You got a director title and a non-compete. Maya took her thirty percent and started something new without you.",
    color: "text-amber-400",
  },
  ghosted: {
    label: "GHOSTED",
    subtitle:
      "Wagr never quite registered. The algorithm didn't notice. The co-working space lease expired. You still have the hoodie.",
    color: "text-white/60",
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [isMuted, setIsMuted] = useState(false);

  const phase = useSessionStore((s) => s.phase);
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const { sceneIndex, currentLineIndex, showChoices, choiceMade } =
    useSessionStore(useShallow((s) => s.progress));
  const { hype, integrity } = useSessionStore(useShallow((s) => s.stats));
  const ending = useSessionStore((s) => s.ending);
  const historyCount = useSessionStore((s) => s.history.length);
  const playthroughId = useSessionStore((s) => s.playthroughId);

  const {
    setPlaythroughId,
    keysConfirmed,
    introSubmitted,
    enterScenes,
    advanceLine,
    chooseOption,
    advanceScene,
    reset,
  } = useSessionStore(
    useShallow((s) => ({
      setPlaythroughId: s.setPlaythroughId,
      keysConfirmed: s.keysConfirmed,
      introSubmitted: s.introSubmitted,
      enterScenes: s.enterScenes,
      advanceLine: s.advanceLine,
      chooseOption: s.chooseOption,
      advanceScene: s.advanceScene,
      reset: s.reset,
    })),
  );

  // -------------------------------------------------------------------------
  // Dev: skip API key panel when .env.local keys are present
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!hasHydrated) return;
    if (process.env.NODE_ENV !== "development") return;
    if (phase !== "api-keys") return;
    fetch("/api/dev-keys")
      .then((r) => r.json())
      .then((data: { skip: boolean }) => {
        if (data.skip) keysConfirmed();
      })
      .catch(() => {});
  }, [hasHydrated, phase, keysConfirmed]);

  // -------------------------------------------------------------------------
  // DB capture
  // -------------------------------------------------------------------------

  // Tracks when the choice panel became visible, for time_to_choose_ms.
  const choiceShownAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (showChoices) {
      if (choiceShownAtRef.current === null) {
        choiceShownAtRef.current = Date.now();
      }
    } else {
      choiceShownAtRef.current = null;
    }
  }, [showChoices]);

  // Finalize the playthrough exactly once when the ending lands.
  const finalizedRef = useRef(false);
  useEffect(() => {
    if (phase !== "ending") {
      finalizedRef.current = false;
      return;
    }
    if (finalizedRef.current) return;
    if (!playthroughId || !ending) return;
    finalizedRef.current = true;
    fetch(`/api/playthroughs/${playthroughId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ending: ending.key,
        epilogue: null,
        achievements: ending.achievementsUnlocked,
      }),
    }).catch((err) => console.error("finalizePlaythrough failed", err));
  }, [phase, playthroughId, ending]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleKeysConfirmed = useCallback(
    (_keys: ApiKeys) => {
      keysConfirmed();
    },
    [keysConfirmed],
  );

  const handleMuteToggle = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const handleIntroSubmit = useCallback(() => {
    const startupName = "Wagr";
    const startupDescription = "Venmo for sports bets between friends";
    setPlaythroughId(undefined);
    introSubmitted("", { startupName, startupDescription });
    fetch("/api/playthroughs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startupName,
        startupDescription,
        flavorTags: [],
        introTranscript: "",
      }),
    })
      .then((r) => r.json())
      .then((data: { id?: string }) => {
        if (data.id) setPlaythroughId(data.id);
      })
      .catch((err) => console.error("createPlaythrough failed", err));
  }, [introSubmitted, setPlaythroughId]);

  const handleLineComplete = useCallback(() => {
    const scene = SCENES[sceneIndex];
    if (!scene) return;
    advanceLine(scene.dialogue.length);
  }, [sceneIndex, advanceLine]);

  const handleChoice = useCallback(
    (choiceId: string, freeText?: string) => {
      const scene = SCENES[sceneIndex];
      const choice = scene?.choices.find((c) => c.id === choiceId);
      const hypeDelta = choice?.hype ?? 0;
      const integrityDelta = choice?.integrity ?? 0;
      chooseOption(choiceId, hypeDelta, integrityDelta);

      if (playthroughId && scene) {
        const startedAt = choiceShownAtRef.current;
        const timeToChooseMs =
          startedAt !== null ? Date.now() - startedAt : null;
        fetch(`/api/playthroughs/${playthroughId}/scenes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sceneNumber: scene.id,
            dialogue: scene.dialogue
              .map((d) => `${d.speaker}: ${d.text}`)
              .join("\n"),
            choicesShown: scene.choices.map((c) => ({
              id: c.id,
              label: c.label,
            })),
            choicePicked: choiceId,
            freeText: freeText ?? null,
            wasTimeout: false,
            timeToChooseMs,
            statDeltas: { hype: hypeDelta, integrity: integrityDelta },
          }),
        }).catch((err) => console.error("logSceneEvent failed", err));
      }

      setTimeout(() => {
        advanceScene(SCENES.length);
      }, 600);
    },
    [sceneIndex, chooseOption, advanceScene, playthroughId],
  );

  const handleTextSubmit = useCallback(
    (text: string) => {
      // Scene 3 counter-offer: classify as "walk" for now (integrity boost)
      handleChoice("b", text);
    },
    [handleChoice],
  );

  // -------------------------------------------------------------------------
  // Derived slots
  // -------------------------------------------------------------------------

  const muteButton = (
    <MuteButton isMuted={isMuted} onToggle={handleMuteToggle} />
  );

  const currentScene = SCENES[sceneIndex] ?? null;
  const currentLine = currentScene?.dialogue[currentLineIndex] ?? null;

  const dialogueSlot =
    phase === "scene" && currentLine ? (
      <div className="w-full max-w-2xl mx-auto px-2 select-none">
        <DialogueSpeaker
          speaker={showChoices ? undefined : currentLine.speaker}
        />
        {!showChoices && (
          <DialogueSubtitle
            key={`scene${sceneIndex}-line${currentLineIndex}`}
            text={currentLine.text}
            wordInterval={110}
            onComplete={handleLineComplete}
          />
        )}
      </div>
    ) : null;

  const bottomPanel = (() => {
    if (phase !== "scene" || !showChoices) return null;

    // Scene 3 gets an extra free-text counter-offer option
    if (currentScene?.id === 3 && !isMuted) {
      return (
        <div className="flex flex-col gap-3">
          <ChoicePanel
            choices={currentScene.choices}
            onChoice={handleChoice}
            disabled={choiceMade !== null}
          />
          <TextInputPanel
            placeholder="Counter-offer… (e.g. Keep Maya, drop the clause)"
            onSubmit={handleTextSubmit}
            disabled={choiceMade !== null}
          />
        </div>
      );
    }

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
        choices={currentScene?.choices ?? []}
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
              You&apos;re the founder of{" "}
              <span className="text-white font-medium">Wagr</span> — Venmo for
              sports bets between friends. Ex-Stripe. First-time founder. Your
              co-founder is already texting.
            </p>
            <button
              onClick={handleIntroSubmit}
              className="mt-2 w-full bg-white text-black font-semibold rounded-lg py-3 hover:bg-white/90 transition-colors text-sm"
            >
              Board the flight →
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
              onClick={() => enterScenes()}
              className="mt-4 text-white/30 hover:text-white/60 text-xs underline transition-colors"
            >
              Enter →
            </button>
          </div>
        );

      case "scene":
        return (
          <div className="absolute top-16 left-6">
            <p
              className="text-white/30 text-xs font-semibold tracking-widest uppercase"
              style={{ letterSpacing: "0.18em" }}
            >
              {currentScene?.title ?? ""}
            </p>
          </div>
        );

      case "ending": {
        const e = ending ? ENDING_COPY[ending.key] : null;
        return (
          <div className="backdrop-panel animate-fade-slide-up rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-5">
            <p className="text-white/40 text-xs font-semibold tracking-widest uppercase">
              Your ending
            </p>
            <h2
              className={`text-3xl font-bold tracking-tight ${e?.color ?? "text-white"}`}
            >
              {e?.label ?? "UNKNOWN"}
            </h2>
            <p className="text-white/60 text-sm leading-relaxed">
              {e?.subtitle}
            </p>
            <div className="border-t border-white/10 pt-4 flex flex-col gap-1 text-xs text-white/30">
              <span>
                Hype {hype > 0 ? "+" : ""}
                {hype} · Integrity {integrity > 0 ? "+" : ""}
                {integrity}
              </span>
              <span>{historyCount} choices made</span>
            </div>
            <button
              onClick={() => reset()}
              className="mt-2 w-full border border-white/20 text-white/70 font-medium rounded-lg py-3 hover:bg-white/5 transition-colors text-sm"
            >
              Play again →
            </button>
          </div>
        );
      }
    }
  })();

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!hasHydrated) return null;

  return (
    <>
      {phase === "api-keys" && <ApiKeysPanel onConfirm={handleKeysConfirmed} />}

      <GameShell
        backgroundSrc="/intro-v2/01-departure-board.png"
        muteButton={muteButton}
        dialogueSlot={dialogueSlot}
        bottomPanel={bottomPanel}
      >
        {centerContent}
      </GameShell>
    </>
  );
}
