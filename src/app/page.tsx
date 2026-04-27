"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { GameShell } from "@/components/GameShell";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";
import DialogueSubtitle from "@/components/DialogueSubtitle";
import DialogueSpeaker from "@/components/DialogueSpeaker";
import PaywallPanel from "@/components/PaywallPanel";
import LoginModal from "@/components/LoginModal";
import { useSessionStore } from "@/lib/session";
import type { EndingKey } from "@/lib/types";
import type { IntroData } from "@/lib/session";
import { SCENES, HOME_BACKGROUND } from "@/lib/scenes";

// ---------------------------------------------------------------------------
// Welcome narration — pre-trip, before the player has booked the flight
// ---------------------------------------------------------------------------

const WELCOME_LINES = [
  "You've been thinking about San Francisco for two years.",
  "Tonight, someone calls.",
  "Five scenes between you and the rest of your life.",
];

const WELCOME_BACKGROUND = "/intro-v2/01-departure-board.png";

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
    captureIntro,
    paywallSatisfied,
    advanceLine,
    chooseOption,
    advanceScene,
    reset,
  } = useSessionStore(
    useShallow((s) => ({
      setPlaythroughId: s.setPlaythroughId,
      welcomeStarted: s.welcomeStarted,
      captureIntro: s.captureIntro,
      paywallSatisfied: s.paywallSatisfied,
      advanceLine: s.advanceLine,
      chooseOption: s.chooseOption,
      advanceScene: s.advanceScene,
      reset: s.reset,
    })),
  );

  const router = useRouter();
  const [welcomeLineIndex, setWelcomeLineIndex] = useState(0);
  const [welcomeDone, setWelcomeDone] = useState(false);
  const welcomeCompleteRef = useRef(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // Tracks the email currently logged in, for showing/hiding "Past flights"
  // CTAs without flashing them while we're still fetching /api/auth/me.
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  // Best-effort session probe — runs once on mount, again after a successful
  // login, again when arriving at the ending screen (paywall verify auto-
  // issues a session cookie, so we want to surface the "Past flights" CTA
  // without needing a page reload).
  const fetchSessionEmail = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { email?: string | null };
      setSessionEmail(data.email ?? null);
    } catch {
      /* network blip — leave previous value */
    }
  }, []);

  useEffect(() => {
    // setState happens inside the async fetch resolution, not during the
    // effect body — the cascading-render concern doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSessionEmail();
  }, [fetchSessionEmail]);

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
    // Paywall verify auto-issued a session cookie a few seconds ago — re-probe
    // /api/auth/me so the ending screen can show "Past flights" without a
    // full reload. setState happens after the async fetch resolves, not in
    // the effect body, so the lint rule's worry about cascading renders
    // doesn't apply here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSessionEmail();
  }, [phase, playthroughId, ending, fetchSessionEmail]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleStart = useCallback(() => {
    setPlaythroughId(undefined);
    welcomeStarted();
    fetch("/api/playthroughs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flavorTags: [],
        introTranscript: "",
      }),
    })
      .then((r) => r.json())
      .then((data: { id?: string }) => {
        if (data.id) setPlaythroughId(data.id);
      })
      .catch((err) => console.error("createPlaythrough failed", err));
  }, [welcomeStarted, setPlaythroughId]);

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
    (choiceId: string) => {
      const scene = SCENES[sceneIndex];
      const choice = scene?.choices?.find((c) => c.id === choiceId);
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
              .map((d) => `${d.speaker ?? ""}: ${d.text}`)
              .join("\n"),
            choicesShown: (scene.choices ?? []).map((c) => ({
              id: c.id,
              label: c.label,
            })),
            choicePicked: choiceId,
            freeText: null,
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

  const handleSceneTextSubmit = useCallback(
    (text: string) => {
      const scene = SCENES[sceneIndex];
      if (!scene?.textInput) return;

      const updates: Partial<IntroData> = { transcript: text };
      switch (scene.textInput.extractAs) {
        case "startupDescription":
          updates.startupDescription = text;
          break;
        case "selfDescription":
          updates.selfDescription = text;
          break;
        case "stage":
          updates.flavorTags = [`stage:${text}`];
          break;
      }
      captureIntro(updates);

      chooseOption("text", 0, 0);

      if (playthroughId) {
        const startedAt = choiceShownAtRef.current;
        const timeToChooseMs =
          startedAt !== null ? Date.now() - startedAt : null;
        fetch(`/api/playthroughs/${playthroughId}/scenes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sceneNumber: scene.id,
            dialogue: scene.dialogue
              .map((d) => `${d.speaker ?? ""}: ${d.text}`)
              .join("\n"),
            choicesShown: [],
            choicePicked: "text",
            freeText: text,
            wasTimeout: false,
            timeToChooseMs,
            statDeltas: { hype: 0, integrity: 0 },
          }),
        }).catch((err) => console.error("logSceneEvent failed", err));
      }

      setTimeout(() => {
        advanceScene(SCENES.length);
      }, 600);
    },
    [sceneIndex, captureIntro, chooseOption, advanceScene, playthroughId],
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
        <div className="w-full max-w-md mx-auto animate-bounce-in flex flex-col gap-2">
          <button
            onClick={handleStart}
            className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-[var(--color-ink)]"
            style={{
              background: "var(--color-sunset)",
              letterSpacing: "-0.005em",
            }}
          >
            Start →
          </button>
          <button
            type="button"
            onClick={() => {
              if (sessionEmail) {
                router.push("/history");
              } else {
                setLoginOpen(true);
              }
            }}
            className="text-[12px] tracking-wide hover:underline self-center"
            style={{ color: "rgba(32,32,31,0.65)" }}
          >
            {sessionEmail
              ? "View past flights →"
              : "Already played? Log in →"}
          </button>
        </div>
      );
    }

    if (phase !== "scene" || !showChoices) return null;

    if (currentScene?.textInput) {
      return (
        <TextInputPanel
          placeholder={currentScene.textInput.placeholder}
          onSubmit={handleSceneTextSubmit}
          disabled={choiceMade !== null}
        />
      );
    }

    if (currentScene?.ctaLabel) {
      return (
        <div className="w-full max-w-md mx-auto animate-bounce-in">
          <button
            onClick={() => handleChoice("commit")}
            disabled={choiceMade !== null}
            className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-[var(--color-ink)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "var(--color-sunset)",
              letterSpacing: "-0.005em",
            }}
          >
            {currentScene.ctaLabel}
          </button>
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
        // Vestigial — current flow goes welcome → scene directly. Kept so
        // any persisted sessions on the old phase don't crash the renderer.
        return null;

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
              {sessionEmail && (
                <button
                  type="button"
                  onClick={() => router.push("/history")}
                  className="text-[12px] tracking-wide hover:underline self-center mt-1"
                  style={{ color: "rgba(32,32,31,0.65)" }}
                >
                  View past flights →
                </button>
              )}
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

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSuccess={(emailFromServer) => {
            setLoginOpen(false);
            setSessionEmail(emailFromServer);
            router.push("/history");
          }}
        />
      )}

      <GameShell
        backgroundSrc={
          phase === "welcome"
            ? WELCOME_BACKGROUND
            : phase === "scene"
              ? (currentScene?.background ?? HOME_BACKGROUND)
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
