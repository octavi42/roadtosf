"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { GameShell } from "@/components/GameShell";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";
import DialogueSubtitle from "@/components/DialogueSubtitle";
import DialogueSpeaker from "@/components/DialogueSpeaker";
import OnboardingPanel from "@/components/OnboardingPanel";
import PaywallPanel from "@/components/PaywallPanel";
import { useSessionStore } from "@/lib/session";
import type { EndingKey } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// Welcome narration — host explains the game over a static SF backdrop
// ---------------------------------------------------------------------------

const WELCOME_LINES = [
  "Welcome. You've just landed in San Francisco.",
  "Five scenes. Five timed choices. Twelve endings.",
  "What happens next is up to you.",
];

const WELCOME_BACKGROUND = "/intro-v2/05-sfo-arrival.png";

const ONBOARDING_LINES = [
  "Now then.",
  "Tell me about your startup.",
];

const ONBOARDING_BACKGROUND = "/intro-v2/03-airport-bar.png";

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
  { label: string; subtitle: string; bg: string }
> = {
  ipo: {
    label: "IPO",
    subtitle:
      "Wagr rang the bell at NYSE on a Tuesday. You cried. Maya didn't come. The Bloomberg headline called you 'the unlikely conscience of fintech.' You framed it.",
    bg: "var(--color-mint)",
  },
  indicted: {
    label: "INDICTED",
    subtitle:
      "The SEC opened an inquiry in November. You're on your third podcast apology tour. Wagr pivoted to compliance software. It still has twelve employees.",
    bg: "var(--color-cable)",
  },
  "ai-wrapper": {
    label: "AI-WRAPPER PIVOT",
    subtitle:
      "You quietly rebranded to WagrAI, laid off four people, and wrote a Substack post called 'Why We're Going Back to Basics.' It got three thousand likes.",
    bg: "var(--color-karl)",
  },
  acquihire: {
    label: "ACQUI-HIRED",
    subtitle:
      "DraftKings bought the team for parts. You got a director title and a non-compete. Maya took her thirty percent and started something new without you.",
    bg: "var(--color-mustard)",
  },
  ghosted: {
    label: "GHOSTED",
    subtitle:
      "Wagr never quite registered. The algorithm didn't notice. The co-working space lease expired. You still have the hoodie.",
    bg: "var(--color-fog-soft)",
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const phase = useSessionStore((s) => s.phase);
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const { sceneIndex, currentLineIndex, showChoices, choiceMade } =
    useSessionStore(useShallow((s) => s.progress));
  const { hype, integrity } = useSessionStore(useShallow((s) => s.stats));
  const ending = useSessionStore((s) => s.ending);
  const historyCount = useSessionStore((s) => s.history.length);
  const playthroughId = useSessionStore((s) => s.playthroughId);
  const startupName = useSessionStore((s) => s.intro.startupName);

  const {
    setPlaythroughId,
    welcomeStarted,
    introSubmitted,
    paywallSatisfied,
    advanceLine,
    chooseOption,
    advanceScene,
    reset,
  } = useSessionStore(
    useShallow((s) => ({
      setPlaythroughId: s.setPlaythroughId,
      welcomeStarted: s.welcomeStarted,
      introSubmitted: s.introSubmitted,
      paywallSatisfied: s.paywallSatisfied,
      advanceLine: s.advanceLine,
      chooseOption: s.chooseOption,
      advanceScene: s.advanceScene,
      reset: s.reset,
    })),
  );

  const [welcomeLineIndex, setWelcomeLineIndex] = useState(0);
  const [welcomeDone, setWelcomeDone] = useState(false);
  const welcomeCompleteRef = useRef(false);

  const handleWelcomeLineComplete = useCallback(() => {
    if (welcomeCompleteRef.current) return;
    setWelcomeLineIndex((prev) => {
      const next = prev + 1;
      if (next >= WELCOME_LINES.length) {
        welcomeCompleteRef.current = true;
        setWelcomeDone(true);
        return prev;
      }
      return next;
    });
  }, []);

  const [onboardingLineIndex, setOnboardingLineIndex] = useState(0);
  const [onboardingNarrationDone, setOnboardingNarrationDone] = useState(false);
  const onboardingNarrationCompleteRef = useRef(false);

  const handleOnboardingLineComplete = useCallback(() => {
    if (onboardingNarrationCompleteRef.current) return;
    setOnboardingLineIndex((prev) => {
      const next = prev + 1;
      if (next >= ONBOARDING_LINES.length) {
        onboardingNarrationCompleteRef.current = true;
        setOnboardingNarrationDone(true);
        return prev;
      }
      return next;
    });
  }, []);

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

  const handleOnboardingSubmit = useCallback(
    (transcript: string) => {
      setPlaythroughId(undefined);
      introSubmitted(transcript);
      fetch("/api/playthroughs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flavorTags: [],
          introTranscript: transcript,
        }),
      })
        .then((r) => r.json())
        .then((data: { id?: string }) => {
          if (data.id) setPlaythroughId(data.id);
        })
        .catch((err) => console.error("createPlaythrough failed", err));
    },
    [introSubmitted, setPlaythroughId],
  );

  const handleLineComplete = useCallback(() => {
    const scene = SCENES[sceneIndex];
    if (!scene) return;
    advanceLine(scene.dialogue.length);
  }, [sceneIndex, advanceLine]);

  const handleShareX = useCallback(() => {
    if (!ending) return;
    const copy = ENDING_COPY[ending.key];
    const story = ending.epilogue ?? copy.subtitle;
    const headline = startupName
      ? `Built ${startupName} in San Francisco. Got: ${copy.label}.`
      : `San Francisco didn't go as planned. Got: ${copy.label}.`;
    const text = `${story}\n\n${headline}\nTry yours →`;
    const url = window.location.origin;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      text,
    )}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }, [ending, startupName]);

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

  const currentScene = SCENES[sceneIndex] ?? null;
  const currentLine = currentScene?.dialogue[currentLineIndex] ?? null;

  const dialogueSlot = (() => {
    if (phase === "welcome" && !welcomeDone) {
      return (
        <div className="w-full max-w-2xl mx-auto px-2 select-none">
          <DialogueSpeaker speaker={undefined} />
          <DialogueSubtitle
            key={`welcome-line${welcomeLineIndex}`}
            text={WELCOME_LINES[welcomeLineIndex]}
            wordInterval={100}
            onComplete={handleWelcomeLineComplete}
          />
        </div>
      );
    }

    if (phase === "onboarding" && !onboardingNarrationDone) {
      return (
        <div className="w-full max-w-2xl mx-auto px-2 select-none">
          <DialogueSpeaker speaker={undefined} />
          <DialogueSubtitle
            key={`onboarding-line${onboardingLineIndex}`}
            text={ONBOARDING_LINES[onboardingLineIndex]}
            wordInterval={110}
            onComplete={handleOnboardingLineComplete}
          />
        </div>
      );
    }

    if (phase === "scene" && currentLine) {
      return (
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
      );
    }

    return null;
  })();

  const bottomPanel = (() => {
    if (phase === "welcome") {
      if (!welcomeDone) return null;
      return (
        <div className="w-full max-w-md mx-auto animate-bounce-in">
          <button
            onClick={() => welcomeStarted()}
            className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-[var(--color-ink)]"
            style={{
              background: "var(--color-sunset)",
              letterSpacing: "-0.005em",
            }}
          >
            Start →
          </button>
        </div>
      );
    }

    if (phase !== "scene" || !showChoices) return null;

    // Scene 3 gets an extra free-text counter-offer option
    if (currentScene?.id === 3) {
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
      case "welcome":
        return null;

      case "paywall":
        return null;

      case "onboarding":
        if (!onboardingNarrationDone) return null;
        return (
          <OnboardingPanel onSubmit={handleOnboardingSubmit} />
        );

      case "scene":
        return (
          <div className="absolute top-16 left-6">
            <span
              className="comic-outline-sm font-display uppercase font-bold inline-block px-3 py-1 rounded-md"
              style={{
                background: "var(--color-fog)",
                color: "var(--color-ink)",
                fontSize: "0.78rem",
                letterSpacing: "0.16em",
              }}
            >
              {currentScene?.title ?? ""}
            </span>
          </div>
        );

      case "ending": {
        const e = ending ? ENDING_COPY[ending.key] : null;
        return (
          <div
            className="comic-outline animate-bounce-in rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-5"
            style={{ background: "var(--color-fog)" }}
          >
            <p
              className="font-display uppercase font-bold inline-block self-center comic-outline-sm rounded-md px-3 py-1"
              style={{
                background: "var(--color-mustard)",
                color: "var(--color-ink)",
                fontSize: "0.78rem",
                letterSpacing: "0.18em",
              }}
            >
              Your ending
            </p>
            <h2
              className="comic-outline font-sans text-3xl font-bold rounded-xl py-4 px-3 text-[var(--color-ink)]"
              style={{
                background: e?.bg ?? "var(--color-fog-soft)",
                letterSpacing: "-0.01em",
              }}
            >
              {e?.label ?? "UNKNOWN"}
            </h2>
            <p className="font-sans text-[var(--color-ink)]/80 text-sm leading-relaxed">
              {e?.subtitle}
            </p>
            <div
              className="font-pixel pt-4 flex flex-col gap-1 text-base text-[var(--color-ink)]/60"
              style={{ borderTop: "2px dashed var(--color-ink)" }}
            >
              <span>
                Hype {hype > 0 ? "+" : ""}
                {hype} · Integrity {integrity > 0 ? "+" : ""}
                {integrity}
              </span>
              <span>{historyCount} choices made</span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <button
                onClick={handleShareX}
                className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-[var(--color-ink)]"
                style={{
                  background: "var(--color-sunset)",
                  letterSpacing: "-0.005em",
                }}
              >
                Share on X
              </button>
              <button
                onClick={() => reset()}
                className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-[var(--color-ink)]"
                style={{
                  background: "var(--color-mint)",
                  letterSpacing: "-0.005em",
                }}
              >
                Play again →
              </button>
            </div>
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
      {phase === "paywall" && (
        <PaywallPanel onSatisfied={() => paywallSatisfied()} />
      )}

      <GameShell
        backgroundSrc={
          phase === "welcome"
            ? WELCOME_BACKGROUND
            : phase === "onboarding"
              ? ONBOARDING_BACKGROUND
              : "/intro-v2/01-departure-board.png"
        }
        dialogueSlot={dialogueSlot}
        bottomPanel={bottomPanel}
      >
        {centerContent}
      </GameShell>
    </>
  );
}
