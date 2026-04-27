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
import { ARCHETYPES } from "@/lib/archetypes";
import type { EndingKey, Group, StoryArc } from "@/lib/types";

interface ApiKeys {
  openaiKey: string;
  elevenlabsKey: string;
}

const ENDING_COPY: Record<
  EndingKey,
  { label: string; subtitle: string; color: string }
> = {
  ipo: {
    label: "IPO",
    subtitle:
      "Wagr rang the bell at NYSE on a Tuesday. You cried. Maya didn't come.",
    color: "text-emerald-400",
  },
  indicted: {
    label: "INDICTED",
    subtitle:
      "The SEC opened an inquiry in November. You're on your third podcast apology tour.",
    color: "text-red-400",
  },
  "ai-wrapper": {
    label: "AI-WRAPPER PIVOT",
    subtitle:
      "You quietly rebranded, laid off four people, and wrote a Substack post called 'Why We're Going Back to Basics.'",
    color: "text-sky-400",
  },
  acquihire: {
    label: "ACQUI-HIRED",
    subtitle:
      "DraftKings bought the team for parts. You got a director title and a non-compete.",
    color: "text-amber-400",
  },
  ghosted: {
    label: "GHOSTED",
    subtitle:
      "Wagr never quite registered. The algorithm didn't notice. The co-working space lease expired.",
    color: "text-white/60",
  },
};

const TWIST_CARD_MIN_MS = 3000;
const TWIST_CARD_FAILSAFE_MS = 8000;
const GROUP_GEN_TIMEOUT_MS = 20000;

function formatSpeaker(speaker: string): string {
  if (speaker === "player") return "You";
  if (speaker === "narrator") return "";
  const def = ARCHETYPES[speaker as keyof typeof ARCHETYPES];
  if (!def) return speaker;
  return `${def.name} · ${def.title}`;
}

interface GeneratedGroupResponse {
  group: Group;
  source: "llm" | "fallback";
}

async function fetchGroup(payload: Record<string, unknown>): Promise<Group> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROUP_GEN_TIMEOUT_MS);
  try {
    const res = await fetch("/api/generate-group", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`generate-group ${res.status}`);
    const data = (await res.json()) as GeneratedGroupResponse;
    return data.group;
  } finally {
    clearTimeout(timeout);
  }
}

export default function HomePage() {
  const [isMuted, setIsMuted] = useState(false);

  const phase = useSessionStore((s) => s.phase);
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const { groupIndex, sceneIndex, currentLineIndex, showChoices, choiceMade } =
    useSessionStore(useShallow((s) => s.progress));
  const { hype, integrity } = useSessionStore(useShallow((s) => s.stats));
  const ending = useSessionStore((s) => s.ending);
  const intro = useSessionStore(useShallow((s) => s.intro));
  const arc = useSessionStore((s) => s.arc);
  const history = useSessionStore((s) => s.history);
  const playthroughId = useSessionStore((s) => s.playthroughId);

  const {
    setPlaythroughId,
    keysConfirmed,
    introSubmitted,
    enterScenes,
    arcReady,
    groupReady,
    exitTwistCard,
    advanceLine,
    chooseOption,
    advanceScene,
    setEpilogue,
    reset,
  } = useSessionStore(
    useShallow((s) => ({
      setPlaythroughId: s.setPlaythroughId,
      keysConfirmed: s.keysConfirmed,
      introSubmitted: s.introSubmitted,
      enterScenes: s.enterScenes,
      arcReady: s.arcReady,
      groupReady: s.groupReady,
      exitTwistCard: s.exitTwistCard,
      advanceLine: s.advanceLine,
      chooseOption: s.chooseOption,
      advanceScene: s.advanceScene,
      setEpilogue: s.setEpilogue,
      reset: s.reset,
    })),
  );

  // Dev: skip API key panel when .env.local keys are present
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

  // Group 1 generation kicks off when phase enters 'generating'.
  const group1FiredRef = useRef(false);
  useEffect(() => {
    if (phase !== "generating") {
      group1FiredRef.current = false;
      return;
    }
    if (group1FiredRef.current) return;
    group1FiredRef.current = true;

    const startupName = intro.startupName ?? "Wagr";
    const startupDescription =
      intro.startupDescription ?? "Venmo for sports bets between friends";
    const founderPersona = intro.selfDescription ?? "";

    const seed = playthroughId ?? `local-${Date.now()}`;

    fetchGroup({
      groupIndex: 1,
      startupName,
      startupDescription,
      founderPersona,
      flavorTags: intro.flavorTags,
      priorChoices: [],
      currentStats: { hype: 0, integrity: 0 },
      seed,
    })
      .then((group) => {
        const initialArc: StoryArc = {
          startupName,
          founderPersona,
          flavorTags: intro.flavorTags,
          groups: [
            { ...group, status: "ready" },
            { id: 2, twistCard: "", scenes: [], status: "pending" },
            { id: 3, twistCard: "", scenes: [], status: "pending" },
          ],
          stats: {
            firedCofounder: false,
            tookVCMoney: false,
            leakedToPress: false,
            playedSafeDemoDay: false,
          },
        };
        arcReady(initialArc);
        if (playthroughId) {
          fetch(`/api/playthroughs/${playthroughId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ arcJson: initialArc }),
          }).catch(() => {});
        }
        enterScenes();
      })
      .catch((err) => {
        console.error("group 1 generation failed", err);
        // Even the route's fallback couldn't ship — leave the user on the
        // generating screen with a manual entry so they're not stuck.
      });
  }, [phase, intro, playthroughId, arcReady, enterScenes]);

  // Eager trigger for Group N+1 when Scene 3 of Group N mounts.
  const eagerFiredRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (phase !== "scene") return;
    if (sceneIndex !== 2) return; // Scene 3 (0-indexed)
    if (groupIndex >= 2) return; // no Group 4
    if (!arc) return;
    const nextIndex = groupIndex + 1;
    if (eagerFiredRef.current.has(nextIndex)) return;
    if (arc.groups[nextIndex]?.status === "ready") return;
    eagerFiredRef.current.add(nextIndex);

    const payload = {
      groupIndex: nextIndex + 1, // route uses 1-based group ids
      startupName: arc.startupName,
      startupDescription: intro.startupDescription ?? "",
      founderPersona: arc.founderPersona,
      flavorTags: arc.flavorTags,
      priorChoices: history.map((h) => ({
        groupIndex: h.groupIndex,
        sceneId: h.sceneId,
        choiceLabel: h.choiceLabel,
        hypeDelta: h.hypeDelta,
        integrityDelta: h.integrityDelta,
      })),
      currentStats: { hype, integrity },
      seed: playthroughId ?? `local-${arc.startupName}`,
    };

    fetchGroup(payload)
      .then((group) => {
        groupReady(nextIndex, group);
      })
      .catch((err) => {
        console.error(`eager group ${nextIndex + 1} failed`, err);
      });
  }, [
    phase,
    sceneIndex,
    groupIndex,
    arc,
    intro.startupDescription,
    history,
    hype,
    integrity,
    playthroughId,
    groupReady,
  ]);

  // Twist card: enforce min hold + auto-advance once next group ready.
  const twistEnteredAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "twist-card") {
      twistEnteredAtRef.current = null;
      return;
    }
    if (twistEnteredAtRef.current === null) {
      twistEnteredAtRef.current = Date.now();
    }
    const interval = setInterval(() => {
      const elapsed = Date.now() - (twistEnteredAtRef.current ?? Date.now());
      const isLastGroup = groupIndex >= 2;
      const nextReady = arc?.groups[groupIndex + 1]?.status === "ready";
      if (elapsed >= TWIST_CARD_MIN_MS && (isLastGroup || nextReady)) {
        clearInterval(interval);
        exitTwistCard();
        return;
      }
      if (elapsed >= TWIST_CARD_FAILSAFE_MS) {
        clearInterval(interval);
        // Failsafe: pull a fallback for the next group synchronously.
        if (!isLastGroup) {
          fetchGroup({
            groupIndex: groupIndex + 2,
            startupName: arc?.startupName ?? "Wagr",
            startupDescription: intro.startupDescription ?? "",
            founderPersona: arc?.founderPersona ?? "",
            flavorTags: arc?.flavorTags ?? [],
            priorChoices: history,
            currentStats: { hype, integrity },
          })
            .then((group) => {
              groupReady(groupIndex + 1, group);
              exitTwistCard();
            })
            .catch(() => exitTwistCard());
        } else {
          exitTwistCard();
        }
      }
    }, 250);
    return () => clearInterval(interval);
  }, [
    phase,
    groupIndex,
    arc,
    history,
    hype,
    integrity,
    intro.startupDescription,
    exitTwistCard,
    groupReady,
  ]);

  // DB capture
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

  // Finalize the playthrough + generate epilogue once at ending.
  const finalizedRef = useRef(false);
  useEffect(() => {
    if (phase !== "ending") {
      finalizedRef.current = false;
      return;
    }
    if (finalizedRef.current) return;
    if (!ending) return;
    finalizedRef.current = true;

    const epilogueP = fetch("/api/generate-epilogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startupName: arc?.startupName ?? "the startup",
        endingKey: ending.key,
        flavorTags: arc?.flavorTags ?? [],
        choiceHistory: history.map((h) => ({
          groupIndex: h.groupIndex,
          sceneId: h.sceneId,
          choiceLabel: h.choiceLabel,
        })),
      }),
    })
      .then((r) => r.json() as Promise<{ epilogue: string }>)
      .then((data) => {
        setEpilogue(data.epilogue);
        return data.epilogue;
      })
      .catch(() => null);

    if (playthroughId) {
      epilogueP.then((epilogue) => {
        fetch(`/api/playthroughs/${playthroughId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ending: ending.key,
            epilogue,
            achievements: ending.achievementsUnlocked,
          }),
        }).catch((err) => console.error("finalizePlaythrough failed", err));
      });
    }
  }, [phase, ending, playthroughId, arc, history, setEpilogue]);

  // Handlers
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

  const currentGroup = arc?.groups[groupIndex];
  const currentScene = currentGroup?.scenes[sceneIndex] ?? null;
  const currentLine = currentScene?.dialogue[currentLineIndex] ?? null;

  const handleLineComplete = useCallback(() => {
    if (!currentScene) return;
    advanceLine(currentScene.dialogue.length);
  }, [currentScene, advanceLine]);

  const handleChoice = useCallback(
    (choiceId: string, freeText?: string) => {
      if (!currentScene) return;
      const choice = currentScene.choices.find((c) => c.id === choiceId);
      if (!choice) return;
      const hypeDelta = choice.hype;
      const integrityDelta = choice.integrity;
      chooseOption(choiceId, choice.label, hypeDelta, integrityDelta);

      if (playthroughId) {
        const startedAt = choiceShownAtRef.current;
        const timeToChooseMs =
          startedAt !== null ? Date.now() - startedAt : null;
        fetch(`/api/playthroughs/${playthroughId}/scenes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sceneNumber: currentScene.id,
            dialogue: currentScene.dialogue
              .map((d) => `${formatSpeaker(d.speaker)}: ${d.text}`)
              .join("\n"),
            choicesShown: currentScene.choices.map((c) => ({
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
        advanceScene();
      }, 600);
    },
    [currentScene, chooseOption, advanceScene, playthroughId],
  );

  const handleTextSubmit = useCallback(
    (text: string) => {
      // VC-archetype scene: collapse counter-offer to last choice (typically "walk").
      if (!currentScene) return;
      const fallback = currentScene.choices[currentScene.choices.length - 1];
      handleChoice(fallback.id, text);
    },
    [currentScene, handleChoice],
  );

  const muteButton = (
    <MuteButton isMuted={isMuted} onToggle={handleMuteToggle} />
  );

  const dialogueSlot =
    phase === "scene" && currentLine ? (
      <div className="w-full max-w-2xl mx-auto px-2 select-none">
        <DialogueSpeaker
          speaker={
            showChoices ? undefined : formatSpeaker(currentLine.speaker)
          }
        />
        {!showChoices && (
          <DialogueSubtitle
            key={`g${groupIndex}-s${sceneIndex}-l${currentLineIndex}`}
            text={currentLine.text}
            wordInterval={110}
            onComplete={handleLineComplete}
          />
        )}
      </div>
    ) : null;

  const showCounterOfferInput =
    currentScene?.archetype === "vc" && groupIndex === 0;

  const bottomPanel = (() => {
    if (phase !== "scene" || !showChoices || !currentScene) return null;

    if (showCounterOfferInput && !isMuted) {
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
        choices={currentScene.choices}
        onChoice={handleChoice}
        disabled={choiceMade !== null}
      />
    );
  })();

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

      case "twist-card": {
        const text = currentGroup?.twistCard ?? "Word travels fast in SF.";
        return (
          <div className="backdrop-panel animate-fade-slide-up rounded-2xl p-10 max-w-lg w-full text-center flex flex-col gap-3">
            <p className="text-white/40 text-xs font-semibold tracking-widest uppercase">
              Interlude
            </p>
            <p className="text-white text-lg leading-relaxed font-light">
              {text}
            </p>
          </div>
        );
      }

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
              {ending?.epilogue ?? e?.subtitle}
            </p>
            <div className="border-t border-white/10 pt-4 flex flex-col gap-1 text-xs text-white/30">
              <span>
                Hype {hype > 0 ? "+" : ""}
                {hype} · Integrity {integrity > 0 ? "+" : ""}
                {integrity}
              </span>
              <span>{history.length} choices made</span>
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
