"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { GameShell } from "@/components/GameShell";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";
import DialogueSubtitle from "@/components/DialogueSubtitle";
import DialogueSpeaker from "@/components/DialogueSpeaker";
import PaywallPanel from "@/components/PaywallPanel";
import {
  useSessionStore,
  AUTHORED_SCENE_COUNT,
  EPISODE_LENGTH,
} from "@/lib/session";
import { ARCHETYPES } from "@/lib/archetypes";
import type { ArcSkeleton, EndingKey, Scene as LLMScene } from "@/lib/types";
import type { IntroData } from "@/lib/session";
import {
  SCENES,
  HOME_BACKGROUND,
  type SceneData,
  type DialogueLine as AuthoredDialogueLine,
  type Choice as AuthoredChoice,
} from "@/lib/scenes";

const WELCOME_LINES = [
  "You've been thinking about San Francisco for two years.",
  "Tonight, someone calls.",
  "Five scenes between you and the rest of your life.",
];

const WELCOME_BACKGROUND = "/intro-v2/01-departure-board.png";

const END_RUN_CHOICE_ID = "__end_run__";

const ENDING_COPY: Record<
  EndingKey,
  { label: string; subtitle: string; bg: string }
> = {
  ipo: {
    label: "IPO",
    subtitle:
      "You rang the bell at NYSE on a Tuesday. You cried. Maya didn't come. The Bloomberg headline called you 'the unlikely conscience of fintech.' You framed it.",
    bg: "var(--color-mint)",
  },
  indicted: {
    label: "INDICTED",
    subtitle:
      "The SEC opened an inquiry in November. You're on your third podcast apology tour. The company pivoted to compliance software. It still has twelve employees.",
    bg: "var(--color-cable)",
  },
  "ai-wrapper": {
    label: "AI-WRAPPER PIVOT",
    subtitle:
      "You quietly rebranded with an AI suffix, laid off four people, and wrote a Substack post called 'Why We're Going Back to Basics.' It got three thousand likes.",
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
      "The company never quite registered. The algorithm didn't notice. The co-working space lease expired. You still have the hoodie.",
    bg: "var(--color-fog-soft)",
  },
};

interface UnifiedScene {
  id: number;
  title: string;
  background?: string;
  dialogue: AuthoredDialogueLine[];
  choices?: AuthoredChoice[];
  textInput?: SceneData["textInput"];
  questions?: SceneData["questions"];
  ctaLabel?: string;
  isLLM: boolean;
}

function formatArchetypeSpeaker(speaker: string): string {
  if (speaker === "player") return "You";
  if (speaker === "narrator") return "";
  const def = ARCHETYPES[speaker as keyof typeof ARCHETYPES];
  if (!def) return speaker;
  return `${def.name} · ${def.title}`;
}

function adaptLLMScene(scene: LLMScene): UnifiedScene {
  return {
    id: scene.id,
    title: scene.title,
    background: HOME_BACKGROUND,
    dialogue: scene.dialogue.map((d) => ({
      speaker: formatArchetypeSpeaker(d.speaker),
      text: d.text,
    })),
    choices: scene.choices.map((c) => ({
      id: c.id,
      label: c.label,
      hype: c.hype,
      integrity: c.integrity,
    })),
    isLLM: true,
  };
}

// Show the "End my run" exit only after the player has finished one full LLM
// episode. Keeps short runs from ending prematurely.
const END_RUN_VISIBLE_FROM_SCENE_INDEX = AUTHORED_SCENE_COUNT + EPISODE_LENGTH;

function authoredAsUnified(scene: SceneData): UnifiedScene {
  return {
    id: scene.id,
    title: scene.title,
    background: scene.background,
    dialogue: scene.dialogue,
    choices: scene.choices,
    textInput: scene.textInput,
    questions: scene.questions,
    ctaLabel: scene.ctaLabel,
    isLLM: false,
  };
}

const ARC_GEN_TIMEOUT_MS = 45000;
const SCENE_GEN_TIMEOUT_MS = 30000;

interface ArcGenResponse {
  skeleton: ArcSkeleton;
  source: "llm" | "fallback";
}

interface SceneGenResponse {
  scene: LLMScene;
  source: "llm" | "fallback";
}

async function postWithTimeout<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export default function HomePage() {
  const phase = useSessionStore((s) => s.phase);
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const { sceneIndex, currentLineIndex, showChoices, choiceMade } =
    useSessionStore(useShallow((s) => s.progress));
  const { hype, integrity } = useSessionStore(useShallow((s) => s.stats));
  const ending = useSessionStore((s) => s.ending);
  const historyCount = useSessionStore((s) => s.history.length);
  const playthroughId = useSessionStore((s) => s.playthroughId);
  const intro = useSessionStore(useShallow((s) => s.intro));
  const arc = useSessionStore((s) => s.arc);
  const history = useSessionStore((s) => s.history);
  const startupName = intro.startupName;

  const {
    setPlaythroughId,
    welcomeStarted,
    captureIntro,
    paywallSatisfied,
    arcSkeletonReady,
    dynamicSceneReady,
    enterGeneratingArc,
    exitGeneratingArc,
    endRun,
    setEpilogue,
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
      arcSkeletonReady: s.arcSkeletonReady,
      dynamicSceneReady: s.dynamicSceneReady,
      enterGeneratingArc: s.enterGeneratingArc,
      exitGeneratingArc: s.exitGeneratingArc,
      endRun: s.endRun,
      setEpilogue: s.setEpilogue,
      advanceLine: s.advanceLine,
      chooseOption: s.chooseOption,
      advanceScene: s.advanceScene,
      reset: s.reset,
    })),
  );

  const [welcomeLineIndex, setWelcomeLineIndex] = useState(0);
  const [welcomeDone, setWelcomeDone] = useState(false);
  const welcomeCompleteRef = useRef(false);

  // Q&A scenes (e.g. scene 4 car ride) walk through `scene.questions` after
  // the intro dialogue. Local state — resets when the player moves scenes.
  const [qaStepIndex, setQaStepIndex] = useState(0);
  useEffect(() => {
    setQaStepIndex(0);
  }, [sceneIndex]);

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

  const currentScene: UnifiedScene | null = (() => {
    if (sceneIndex < AUTHORED_SCENE_COUNT) {
      const a = SCENES[sceneIndex];
      return a ? authoredAsUnified(a) : null;
    }
    const llmIndex = sceneIndex - AUTHORED_SCENE_COUNT;
    const s = arc?.scenes[llmIndex];
    if (!s || s.dialogue.length === 0) return null;
    return adaptLLMScene(s);
  })();
  const currentLine = currentScene?.dialogue[currentLineIndex] ?? null;

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

  // Helpers for arc-call construction --------------------------------------
  const buildArcRequestBody = useCallback(
    (episodeIndex: number) => {
      // For episode 0: send all authored choices.
      // For episode 1+: send only the most recent episode's choices; older
      // context lives in the rolling storySoFar on `arc`.
      const recentChoices =
        episodeIndex === 0
          ? history
              .filter((h) => h.sceneId <= AUTHORED_SCENE_COUNT)
              .map((h) => ({
                sceneId: h.sceneId,
                choiceLabel: h.choiceLabel,
                hypeDelta: h.hypeDelta,
                integrityDelta: h.integrityDelta,
              }))
          : history.slice(-EPISODE_LENGTH).map((h) => ({
              sceneId: h.sceneId,
              choiceLabel: h.choiceLabel,
              hypeDelta: h.hypeDelta,
              integrityDelta: h.integrityDelta,
            }));

      return {
        episodeIndex,
        priorStorySoFar: arc?.storySoFar,
        startupName: arc?.startupName ?? intro.startupName ?? "the startup",
        startupDescription: intro.startupDescription ?? "",
        founderPersona: arc?.founderPersona ?? intro.selfDescription ?? "",
        stage: arc?.stage ?? intro.stage,
        team: intro.team,
        fundingModel: intro.fundingModel,
        concern: intro.concern,
        flavorTags: arc?.flavorTags ?? intro.flavorTags,
        recentChoices,
        currentStats: { hype, integrity },
        seed: playthroughId ?? `local-${Date.now()}`,
      };
    },
    [arc, intro, history, hype, integrity, playthroughId],
  );

  // Reset all per-run refs when playthroughId changes (new run)
  const arcGenFiredRef = useRef<Set<number>>(new Set()); // episodes already requested
  const sceneGenFiredRef = useRef<Set<number>>(new Set()); // global llm indices already requested
  useEffect(() => {
    arcGenFiredRef.current = new Set();
    sceneGenFiredRef.current = new Set();
  }, [playthroughId]);

  // Episode 0 generation: fire when entering authored scene 5 (the last
  // authored). Sonnet runs in the background while the player reads / types.
  useEffect(() => {
    if (phase !== "scene") return;
    if (sceneIndex !== AUTHORED_SCENE_COUNT - 1) return;
    if (arc?.arcSkeleton?.episodeIndex === 0) return;
    if (arcGenFiredRef.current.has(0)) return;
    arcGenFiredRef.current.add(0);

    postWithTimeout<ArcGenResponse>(
      "/api/generate-arc",
      buildArcRequestBody(0),
      ARC_GEN_TIMEOUT_MS,
    )
      .then((data) => arcSkeletonReady(data.skeleton))
      .catch((err) => console.error("generate-arc[0] failed", err));
  }, [phase, sceneIndex, arc?.arcSkeleton, buildArcRequestBody, arcSkeletonReady]);

  // generating-arc phase: when the *current* skeleton is ready, fire the
  // first LLM scene of that episode and exit into 'scene' phase.
  const firstSceneFiredRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "generating-arc") {
      firstSceneFiredRef.current = null;
      return;
    }
    const skeleton = arc?.arcSkeleton;
    if (!skeleton) return;
    const epi = skeleton.episodeIndex;
    if (firstSceneFiredRef.current === epi) return;
    firstSceneFiredRef.current = epi;

    const globalLLMIndex = epi * EPISODE_LENGTH; // first scene of this episode

    postWithTimeout<SceneGenResponse>(
      "/api/generate-scene",
      {
        llmIndex: globalLLMIndex,
        episodeIndex: epi,
        llmIndexInEpisode: 0,
        arcSkeleton: skeleton,
        storySoFar: arc?.storySoFar,
        startupName: arc?.startupName,
        startupDescription: intro.startupDescription ?? "",
        founderPersona: arc?.founderPersona,
        stage: arc?.stage,
        team: intro.team,
        fundingModel: intro.fundingModel,
        concern: intro.concern,
        flavorTags: arc?.flavorTags,
        recentChoices: history.slice(-EPISODE_LENGTH).map((h) => ({
          sceneId: h.sceneId,
          choiceLabel: h.choiceLabel,
          hypeDelta: h.hypeDelta,
          integrityDelta: h.integrityDelta,
        })),
        currentStats: { hype, integrity },
      },
      SCENE_GEN_TIMEOUT_MS,
    )
      .then((data) => {
        sceneGenFiredRef.current.add(globalLLMIndex);
        dynamicSceneReady(globalLLMIndex, data.scene);
        exitGeneratingArc();
      })
      .catch((err) => {
        console.error("generate-scene[first] failed", err);
        exitGeneratingArc();
      });
  }, [
    phase,
    arc,
    intro.startupDescription,
    history,
    hype,
    integrity,
    dynamicSceneReady,
    exitGeneratingArc,
  ]);

  // Eager next-scene generation: fire scene N+1 as soon as scene N mounts.
  // Runs forever — no upper bound.
  useEffect(() => {
    if (phase !== "scene") return;
    if (sceneIndex < AUTHORED_SCENE_COUNT) return;
    if (!arc?.arcSkeleton) return;

    const llmIndex = sceneIndex - AUTHORED_SCENE_COUNT;
    const nextLLMIndex = llmIndex + 1;
    const skeleton = arc.arcSkeleton;
    const nextInEpisode = nextLLMIndex - skeleton.episodeIndex * EPISODE_LENGTH;

    // Only eager-trigger within the current episode. Cross-episode generation
    // is handled by the regen effect below.
    if (nextInEpisode < 0 || nextInEpisode >= skeleton.scenes.length) return;
    if (sceneGenFiredRef.current.has(nextLLMIndex)) return;
    const stored = arc.scenes[nextLLMIndex];
    if (stored && stored.dialogue.length > 0) return;
    sceneGenFiredRef.current.add(nextLLMIndex);

    postWithTimeout<SceneGenResponse>(
      "/api/generate-scene",
      {
        llmIndex: nextLLMIndex,
        episodeIndex: skeleton.episodeIndex,
        llmIndexInEpisode: nextInEpisode,
        arcSkeleton: skeleton,
        storySoFar: arc.storySoFar,
        startupName: arc.startupName,
        startupDescription: intro.startupDescription ?? "",
        founderPersona: arc.founderPersona,
        stage: arc.stage,
        team: intro.team,
        fundingModel: intro.fundingModel,
        concern: intro.concern,
        flavorTags: arc.flavorTags,
        recentChoices: history.slice(-EPISODE_LENGTH).map((h) => ({
          sceneId: h.sceneId,
          choiceLabel: h.choiceLabel,
          hypeDelta: h.hypeDelta,
          integrityDelta: h.integrityDelta,
        })),
        currentStats: { hype, integrity },
      },
      SCENE_GEN_TIMEOUT_MS,
    )
      .then((data) => dynamicSceneReady(nextLLMIndex, data.scene))
      .catch((err) =>
        console.error(`generate-scene[${nextLLMIndex}] failed`, err),
      );
  }, [
    phase,
    sceneIndex,
    arc,
    intro.startupDescription,
    history,
    hype,
    integrity,
    dynamicSceneReady,
  ]);

  // Episode regeneration: when the current LLM scene is the SECOND-TO-LAST of
  // its episode, kick off generation of the next episode's skeleton in the
  // background. By the time the player advances past the last scene, the new
  // skeleton (and its first scene) should be ready.
  useEffect(() => {
    if (phase !== "scene") return;
    if (sceneIndex < AUTHORED_SCENE_COUNT) return;
    const skeleton = arc?.arcSkeleton;
    if (!skeleton) return;
    const llmIndex = sceneIndex - AUTHORED_SCENE_COUNT;
    const inEpisode = llmIndex - skeleton.episodeIndex * EPISODE_LENGTH;
    // Trigger the regen at the second-to-last scene of the episode (gives the
    // Sonnet call ~one full scene of latency cover).
    if (inEpisode !== EPISODE_LENGTH - 2) return;

    const nextEpisode = skeleton.episodeIndex + 1;
    if (arcGenFiredRef.current.has(nextEpisode)) return;
    arcGenFiredRef.current.add(nextEpisode);

    postWithTimeout<ArcGenResponse>(
      "/api/generate-arc",
      buildArcRequestBody(nextEpisode),
      ARC_GEN_TIMEOUT_MS,
    )
      .then((data) => arcSkeletonReady(data.skeleton))
      .catch((err) => console.error(`generate-arc[${nextEpisode}] failed`, err));
  }, [phase, sceneIndex, arc?.arcSkeleton, buildArcRequestBody, arcSkeletonReady]);

  // After regen: when the new skeleton lands AND we're still in 'scene' phase
  // at the last scene of the prior episode, fire the first scene of the new
  // episode so it's ready when the player advances.
  useEffect(() => {
    if (phase !== "scene") return;
    if (sceneIndex < AUTHORED_SCENE_COUNT) return;
    const skeleton = arc?.arcSkeleton;
    if (!skeleton) return;
    const epi = skeleton.episodeIndex;
    if (epi === 0) return; // episode-0 first-scene is fired by generating-arc effect
    const firstSceneOfNewEpisode = epi * EPISODE_LENGTH;
    if (sceneGenFiredRef.current.has(firstSceneOfNewEpisode)) return;
    const stored = arc?.scenes[firstSceneOfNewEpisode];
    if (stored && stored.dialogue.length > 0) return;
    sceneGenFiredRef.current.add(firstSceneOfNewEpisode);

    postWithTimeout<SceneGenResponse>(
      "/api/generate-scene",
      {
        llmIndex: firstSceneOfNewEpisode,
        episodeIndex: epi,
        llmIndexInEpisode: 0,
        arcSkeleton: skeleton,
        storySoFar: arc?.storySoFar,
        startupName: arc?.startupName,
        startupDescription: intro.startupDescription ?? "",
        founderPersona: arc?.founderPersona,
        stage: arc?.stage,
        team: intro.team,
        fundingModel: intro.fundingModel,
        concern: intro.concern,
        flavorTags: arc?.flavorTags,
        recentChoices: history.slice(-EPISODE_LENGTH).map((h) => ({
          sceneId: h.sceneId,
          choiceLabel: h.choiceLabel,
          hypeDelta: h.hypeDelta,
          integrityDelta: h.integrityDelta,
        })),
        currentStats: { hype, integrity },
      },
      SCENE_GEN_TIMEOUT_MS,
    )
      .then((data) => dynamicSceneReady(firstSceneOfNewEpisode, data.scene))
      .catch((err) =>
        console.error(`generate-scene[${firstSceneOfNewEpisode}] failed`, err),
      );
  }, [
    phase,
    sceneIndex,
    arc,
    intro.startupDescription,
    history,
    hype,
    integrity,
    dynamicSceneReady,
  ]);

  // Safety: if the player jumps directly to generating-arc via dev panel and
  // there's no skeleton yet, kick the same effect that would normally fire.
  useEffect(() => {
    if (phase !== "generating-arc") return;
    if (!arc?.arcSkeleton) {
      enterGeneratingArc();
    }
  }, [phase, arc?.arcSkeleton, enterGeneratingArc]);

  // Generate epilogue + finalize playthrough at ending.
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
        startupName: arc?.startupName ?? startupName ?? "the startup",
        endingKey: ending.key,
        flavorTags: arc?.flavorTags ?? intro.flavorTags ?? [],
        team: intro.team,
        fundingModel: intro.fundingModel,
        concern: intro.concern,
        choiceHistory: history.map((h) => ({
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
  }, [
    phase,
    ending,
    playthroughId,
    arc,
    intro.flavorTags,
    history,
    startupName,
    setEpilogue,
  ]);

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
    if (!currentScene) return;
    advanceLine(currentScene.dialogue.length);
  }, [currentScene, advanceLine]);

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

  const handleEndRun = useCallback(() => {
    if (!currentScene) return;
    chooseOption(END_RUN_CHOICE_ID, "End my run", 0, 0);
    if (playthroughId) {
      fetch(`/api/playthroughs/${playthroughId}/scenes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sceneNumber: currentScene.id,
          dialogue: currentScene.dialogue
            .map((d) => `${d.speaker ?? ""}: ${d.text}`)
            .join("\n"),
          choicesShown: (currentScene.choices ?? []).map((c) => ({
            id: c.id,
            label: c.label,
          })),
          choicePicked: END_RUN_CHOICE_ID,
          freeText: null,
          wasTimeout: false,
          timeToChooseMs:
            choiceShownAtRef.current !== null
              ? Date.now() - choiceShownAtRef.current
              : null,
          statDeltas: { hype: 0, integrity: 0 },
        }),
      }).catch((err) => console.error("logSceneEvent failed", err));
    }
    setTimeout(() => endRun(), 600);
  }, [currentScene, chooseOption, endRun, playthroughId]);

  const handleChoice = useCallback(
    (choiceId: string) => {
      if (!currentScene) return;

      const choice = currentScene.choices?.find((c) => c.id === choiceId);
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
              .map((d) => `${d.speaker ?? ""}: ${d.text}`)
              .join("\n"),
            choicesShown: (currentScene.choices ?? []).map((c) => ({
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
        advanceScene();
      }, 600);
    },
    [currentScene, chooseOption, advanceScene, playthroughId],
  );

  const handleCTA = useCallback(() => {
    if (!currentScene) return;
    chooseOption("commit", currentScene.ctaLabel ?? "commit", 0, 0);

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
            .map((d) => `${d.speaker ?? ""}: ${d.text}`)
            .join("\n"),
          choicesShown: [],
          choicePicked: "commit",
          freeText: null,
          wasTimeout: false,
          timeToChooseMs,
          statDeltas: { hype: 0, integrity: 0 },
        }),
      }).catch((err) => console.error("logSceneEvent failed", err));
    }

    setTimeout(() => {
      advanceScene();
    }, 600);
  }, [currentScene, chooseOption, advanceScene, playthroughId]);

  const handleQASubmit = useCallback(
    (text: string) => {
      if (!currentScene?.questions) return;
      const question = currentScene.questions[qaStepIndex];
      if (!question) return;

      // Capture the answer to the right field.
      const updates: Partial<IntroData> = {};
      switch (question.extractAs) {
        case "startupDescription":
          updates.startupDescription = text;
          break;
        case "selfDescription":
          updates.selfDescription = text;
          break;
        case "stage":
          updates.stage = text;
          break;
        case "team":
          updates.team = text;
          break;
        case "fundingModel":
          updates.fundingModel = text;
          break;
        case "concern":
          updates.concern = text;
          break;
      }
      captureIntro(updates);

      const isLast = qaStepIndex >= currentScene.questions.length - 1;

      if (playthroughId) {
        const startedAt = choiceShownAtRef.current;
        const timeToChooseMs =
          startedAt !== null ? Date.now() - startedAt : null;
        fetch(`/api/playthroughs/${playthroughId}/scenes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sceneNumber: currentScene.id,
            dialogue: `Q: ${question.prompt.text}\nA: ${text}`,
            choicesShown: [],
            choicePicked: `qa-${question.extractAs}`,
            freeText: text,
            wasTimeout: false,
            timeToChooseMs,
            statDeltas: { hype: 0, integrity: 0 },
          }),
        }).catch((err) => console.error("logSceneEvent failed", err));
      }

      if (isLast) {
        // Last question: log the choice + advance scene.
        chooseOption("qa-done", text, 0, 0);
        setTimeout(() => advanceScene(), 600);
      } else {
        // Reset choice latch so the next prompt re-arms (advanceLine /
        // showChoices wasn't used; we just bump the step index).
        setQaStepIndex((i) => i + 1);
      }
    },
    [currentScene, qaStepIndex, captureIntro, chooseOption, advanceScene, playthroughId],
  );

  const handleSceneTextSubmit = useCallback(
    (text: string) => {
      if (!currentScene?.textInput) return;

      const updates: Partial<IntroData> = { transcript: text };
      switch (currentScene.textInput.extractAs) {
        case "startupDescription":
          updates.startupDescription = text;
          break;
        case "selfDescription":
          updates.selfDescription = text;
          break;
        case "stage":
          updates.stage = text;
          break;
      }
      captureIntro(updates);

      chooseOption("text", text, 0, 0);

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
        advanceScene();
      }, 600);
    },
    [currentScene, captureIntro, chooseOption, advanceScene, playthroughId],
  );

  // For Q&A scenes after intro dialogue completes, render the current
  // question's prompt as a dialogue line so the visual rhythm doesn't break.
  const isQAScene = !!currentScene?.questions && currentScene.questions.length > 0;
  const qaCurrentQuestion =
    isQAScene && currentScene?.questions
      ? currentScene.questions[Math.min(qaStepIndex, currentScene.questions.length - 1)]
      : undefined;
  const qaPromptLine = qaCurrentQuestion?.prompt;
  const showQAPrompt = isQAScene && showChoices && !!qaPromptLine;

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

    if (phase === "scene") {
      // Q&A mode: after intro dialogue, replace dialogue rendering with the
      // current question prompt (one per qaStepIndex).
      if (showQAPrompt && qaPromptLine) {
        return (
          <div className="w-full max-w-2xl mx-auto px-2 select-none">
            <DialogueSpeaker speaker={qaPromptLine.speaker} />
            <DialogueSubtitle
              key={`scene${sceneIndex}-q${qaStepIndex}`}
              text={qaPromptLine.text}
              wordInterval={110}
            />
          </div>
        );
      }

      if (currentLine) {
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
    }

    return null;
  })();

  const bottomPanel = (() => {
    if (phase === "welcome") {
      if (!welcomeDone) return null;
      return (
        <div className="w-full max-w-md mx-auto animate-bounce-in">
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
        </div>
      );
    }

    if (phase !== "scene" || !showChoices) return null;
    if (!currentScene) return null;

    const showEndRun =
      currentScene.isLLM &&
      sceneIndex >= END_RUN_VISIBLE_FROM_SCENE_INDEX &&
      choiceMade === null;

    const endRunLink = showEndRun ? (
      <button
        onClick={handleEndRun}
        className="font-sans text-xs text-[var(--color-ink)]/40 hover:text-[var(--color-ink)]/70 transition-colors py-1 self-center"
      >
        End my run →
      </button>
    ) : null;

    let panel: React.ReactNode;
    if (currentScene.questions && qaCurrentQuestion) {
      panel = (
        <TextInputPanel
          key={`qa-${sceneIndex}-${qaStepIndex}`}
          placeholder={qaCurrentQuestion.placeholder}
          onSubmit={handleQASubmit}
          disabled={false}
        />
      );
    } else if (currentScene.textInput) {
      panel = (
        <TextInputPanel
          placeholder={currentScene.textInput.placeholder}
          onSubmit={handleSceneTextSubmit}
          disabled={choiceMade !== null}
        />
      );
    } else if (currentScene.ctaLabel) {
      panel = (
        <div className="w-full max-w-md mx-auto animate-bounce-in">
          <button
            onClick={handleCTA}
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
    } else {
      panel = (
        <ChoicePanel
          choices={currentScene.choices ?? []}
          onChoice={handleChoice}
          disabled={choiceMade !== null}
        />
      );
    }

    if (!endRunLink) return panel;
    return (
      <div className="flex flex-col gap-2">
        {panel}
        {endRunLink}
      </div>
    );
  })();

  const centerContent = (() => {
    switch (phase) {
      case "welcome":
        return null;

      case "paywall":
        return null;

      case "onboarding":
        return null;

      case "generating-arc":
        return (
          <div
            className="comic-outline animate-bounce-in rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-4"
            style={{ background: "var(--color-fog)" }}
          >
            <div className="flex justify-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: "var(--color-ink)",
                    opacity: 0.5,
                    animation: "pulse 1.6s ease-in-out infinite",
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
            <p className="font-sans text-[var(--color-ink)]/80 text-sm leading-relaxed">
              The city's still loading.
              <br />
              Pick your end whenever you're ready.
            </p>
          </div>
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
              {ending?.epilogue ?? e?.subtitle}
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
            : phase === "scene"
              ? (currentScene?.background ?? HOME_BACKGROUND)
              : phase === "generating-arc"
                ? HOME_BACKGROUND
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
