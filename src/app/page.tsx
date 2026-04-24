"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { GameShell } from "@/components/GameShell";
import ApiKeysPanel from "@/components/ApiKeysPanel";
import MuteButton from "@/components/MuteButton";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";
import DialogueSubtitle from "@/components/DialogueSubtitle";
import DialogueSpeaker from "@/components/DialogueSpeaker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "api-keys" | "intro" | "generating" | "scene" | "ending";

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

type EndingKey = "ipo" | "indicted" | "ai-wrapper" | "acquihire" | "ghosted";

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

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

function classifyEnding(hype: number, integrity: number): EndingKey {
  const magnitude = Math.abs(hype) + Math.abs(integrity);
  if (magnitude < 3) return "ghosted";
  if (hype >= 2 && integrity >= 2) return "ipo";
  if (hype >= 2 && integrity < 0) return "indicted";
  if (hype < 0 && integrity >= 2) return "ai-wrapper";
  if (hype < 0 && integrity < 0) return "acquihire";
  return "ghosted";
}

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
  const [phase, setPhase] = useState<Phase>("api-keys");
  const [isMuted, setIsMuted] = useState(false);

  // Story state
  const [sceneIndex, setSceneIndex] = useState(0);
  const [choiceHistory, setChoiceHistory] = useState<string[]>([]);
  const [hype, setHype] = useState(0);
  const [integrity, setIntegrity] = useState(0);
  const [ending, setEnding] = useState<EndingKey | null>(null);

  // Dialogue playback state
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [showChoices, setShowChoices] = useState(false);
  const [choiceMade, setChoiceMade] = useState<string | null>(null);
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
      .catch(() => {});
  }, []);

  // -------------------------------------------------------------------------
  // Reset dialogue state whenever scene changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== "scene") return;
    setCurrentLineIndex(0);
    setShowChoices(false);
    setChoiceMade(null);
    onCompleteCalledRef.current = false;
  }, [phase, sceneIndex]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleKeysConfirmed = useCallback((_keys: ApiKeys) => {
    setPhase("intro");
  }, []);

  const handleMuteToggle = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Called when each dialogue line finishes animating
  const handleLineComplete = useCallback(() => {
    if (onCompleteCalledRef.current) return;

    setCurrentLineIndex((prev) => {
      const scene = SCENES[sceneIndex];
      const next = prev + 1;
      if (next >= scene.dialogue.length) {
        onCompleteCalledRef.current = true;
        setShowChoices(true);
        return prev;
      }
      return next;
    });
  }, [sceneIndex]);

  // Called when the player picks a choice
  const handleChoice = useCallback(
    (choiceId: string) => {
      const scene = SCENES[sceneIndex];
      const choice = scene.choices.find((c) => c.id === choiceId);

      // Apply stat deltas
      const dHype = choice?.hype ?? 0;
      const dIntegrity = choice?.integrity ?? 0;
      const nextHype = hype + dHype;
      const nextIntegrity = integrity + dIntegrity;

      setHype(nextHype);
      setIntegrity(nextIntegrity);
      setChoiceHistory((prev) => [...prev, `scene${scene.id}:${choiceId}`]);
      setChoiceMade(choiceId);

      // Brief pause so the selected button state is visible, then advance
      setTimeout(() => {
        const nextSceneIndex = sceneIndex + 1;
        if (nextSceneIndex >= SCENES.length) {
          // All scenes done — classify ending
          setEnding(classifyEnding(nextHype, nextIntegrity));
          setPhase("ending");
        } else {
          setSceneIndex(nextSceneIndex);
          // Reset for next scene (useEffect will also fire but belt+suspenders)
          setCurrentLineIndex(0);
          setShowChoices(false);
          setChoiceMade(null);
          onCompleteCalledRef.current = false;
        }
      }, 600);
    },
    [sceneIndex, hype, integrity],
  );

  const handleTextSubmit = useCallback(
    (text: string) => {
      console.log("[counter-offer]", text);
      // Scene 3 counter-offer: classify as "walk" for now (integrity boost)
      handleChoice("b");
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
              onClick={() => setPhase("generating")}
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
              onClick={() => setPhase("scene")}
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
        const e = ending ? ENDING_COPY[ending] : null;
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
              <span>{choiceHistory.length} choices made</span>
            </div>
            <button
              onClick={() => {
                setSceneIndex(0);
                setChoiceHistory([]);
                setHype(0);
                setIntegrity(0);
                setEnding(null);
                setPhase("intro");
              }}
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
