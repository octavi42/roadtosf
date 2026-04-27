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
import {
  useSessionStore,
  AUTHORED_SCENE_COUNT,
  EPISODE_LENGTH,
} from "@/lib/session";
import { ARCHETYPES } from "@/lib/archetypes";
import type { ArcSkeleton, EndingKey, Scene as LLMScene } from "@/lib/types";
import type {
  IntroData,
  MissingQuestion,
  MissingQuestionField,
} from "@/lib/session";
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
      "You rang the bell at NYSE on a Tuesday. You cried in the green room. The Bloomberg headline called you 'the unlikely conscience of fintech.' You framed it.",
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
      "DraftKings bought the team for parts. You got a director title and a non-compete. The acquirer kept the IP and quietly retired the brand.",
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
  // Authored-only — the single-CTA dare → paywall scene relies on this.
  // LLM scenes don't set it.
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
    // Generated scene image takes over once it lands; HOME_BACKGROUND is the
    // placeholder while gpt-image-2 is still in flight.
    background: scene.imageUrl ?? HOME_BACKGROUND,
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

const QA_PLACEHOLDERS: Record<MissingQuestionField, string> = {
  team: "Solo, cofounder, or team?",
  fundingModel: "Bootstrap, raised, runway?",
  stage: "Idea, MVP, users, revenue?",
  targetCustomer: "Who's actually using it?",
  concern: "What's broken right now?",
};

// Scene 4 (the car-ride Q&A) has three modes:
//   - extraction hasn't run yet (or failed) → use the hardcoded 3 questions
//   - extraction returned >0 missing → ask only those, in Jordan's voice
//   - extraction returned 0 missing → swap in a single beat + CTA, no inputs
function buildScene4ForExtraction(
  base: UnifiedScene,
  missing: MissingQuestion[],
): UnifiedScene {
  if (missing.length === 0) {
    return {
      ...base,
      dialogue: [
        {
          speaker: "Jordan · Friend, SF",
          text: "Throw your bag in the back. You already told me everything I needed.",
        },
        {
          speaker: "Jordan · Friend, SF",
          text: "Good. You're ready. Drive faster.",
        },
      ],
      questions: undefined,
      textInput: undefined,
      choices: undefined,
      ctaLabel: "Hit the 101 →",
    };
  }
  return {
    ...base,
    questions: missing.map((m) => ({
      prompt: { speaker: "Jordan · Friend, SF", text: m.question },
      placeholder: QA_PLACEHOLDERS[m.field] ?? "",
      extractAs: m.field,
    })),
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
    factsExtracted,
    paywallSatisfied,
    arcSkeletonReady,
    dynamicSceneReady,
    sceneImageReady,
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
      factsExtracted: s.factsExtracted,
      paywallSatisfied: s.paywallSatisfied,
      arcSkeletonReady: s.arcSkeletonReady,
      dynamicSceneReady: s.dynamicSceneReady,
      sceneImageReady: s.sceneImageReady,
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
      if (!a) return null;
      const unified = authoredAsUnified(a);
      // Scene 4 (the car-ride Q&A) is the only authored scene that gets
      // morphed by extraction results. Earlier scenes pass through.
      if (a.id === 4 && intro.missingQuestions !== undefined) {
        return buildScene4ForExtraction(unified, intro.missingQuestions);
      }
      return unified;
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
        targetCustomer: intro.targetCustomer,
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
  const imageGenFiredRef = useRef<Set<number>>(new Set()); // llm indices whose image gen was requested
  const arcPersistedRef = useRef<number>(-1); // last episodeIndex whose skeleton was PATCHed
  const extractFiredForRef = useRef<string | null>(null); // last startupDescription extracted for
  // Flips true once extraction has settled (success or failure). Arc-gen is
  // gated on this so Sonnet never receives a half-populated player facts block
  // — the cause of the "Maya in The Uninvited Cofounder" bleed.
  const [extractionResolved, setExtractionResolved] = useState(false);
  useEffect(() => {
    arcGenFiredRef.current = new Set();
    sceneGenFiredRef.current = new Set();
    imageGenFiredRef.current = new Set();
    arcPersistedRef.current = -1;
    extractFiredForRef.current = null;
    setExtractionResolved(false);
  }, [playthroughId]);

  // Smart Q&A extraction: once the player submits the scene-2 pitch, fire one
  // Haiku call that extracts the canonical facts AND generates Jordan-voice
  // follow-ups for whatever's missing. Result drives scene 4. Always flip
  // extractionResolved so arc-gen is unblocked even on failure.
  useEffect(() => {
    const desc = intro.startupDescription?.trim();
    if (!desc) return;
    if (extractFiredForRef.current === desc) return;
    extractFiredForRef.current = desc;

    fetch("/api/extract-facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startupDescription: desc,
        founderPersona: intro.selfDescription ?? "",
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`extract-facts ${r.status}`);
        return r.json() as Promise<{
          extracted: Partial<IntroData>;
          missing: MissingQuestion[];
        }>;
      })
      .then((data) => {
        const extractedKeys = Object.keys(data.extracted ?? {}).filter(
          (k) =>
            typeof (data.extracted as Record<string, unknown>)[k] === "string" &&
            ((data.extracted as Record<string, string>)[k] ?? "").trim() !== "",
        );
        // Distinguish a true LLM failure (route returned the empty stub) from
        // a legitimate "everything was already covered" response. If both
        // halves are empty, leave missingQuestions undefined so the page
        // falls back to the hardcoded 3 questions.
        if (extractedKeys.length === 0 && (data.missing ?? []).length === 0) {
          extractFiredForRef.current = null; // allow a retry on a future change
          return;
        }
        factsExtracted({
          extracted: data.extracted ?? {},
          missing: data.missing ?? [],
        });
      })
      .catch((err) => {
        console.warn("extract-facts failed", err);
        extractFiredForRef.current = null;
      })
      .finally(() => {
        setExtractionResolved(true);
      });
  }, [intro.startupDescription, intro.selfDescription, factsExtracted]);

  // Episode 0 generation: fire from the second-to-last authored scene onward
  // (same overlap idea as episode regen). Sonnet/Haiku runs while the player
  // finishes the last authored beats. One fewer authored choice is in
  // recentChoices until the player reaches the final authored scene — usually
  // minor vs the latency win.
  // Gated on extraction having resolved — otherwise Sonnet receives an
  // undefined team and falls back to inventing a cofounder (the Maya bleed).
  // Safety bypass: if the player jumped straight here via the dev panel and
  // never submitted scene 2, extraction will never fire — fall back to firing
  // arc-gen anyway so the run isn't soft-locked.
  useEffect(() => {
    if (phase !== "scene") return;
    if (sceneIndex < AUTHORED_SCENE_COUNT - 2) return;
    if (arc?.arcSkeleton?.episodeIndex === 0) return;
    if (arcGenFiredRef.current.has(0)) return;
    const noPitchSubmitted = !intro.startupDescription?.trim();
    if (!extractionResolved && !noPitchSubmitted) return;
    arcGenFiredRef.current.add(0);

    postWithTimeout<ArcGenResponse>(
      "/api/generate-arc",
      buildArcRequestBody(0),
      ARC_GEN_TIMEOUT_MS,
    )
      .then((data) => arcSkeletonReady(data.skeleton))
      .catch((err) => console.error("generate-arc[0] failed", err));
  }, [
    phase,
    sceneIndex,
    arc?.arcSkeleton,
    extractionResolved,
    intro.startupDescription,
    buildArcRequestBody,
    arcSkeletonReady,
  ]);

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
        targetCustomer: intro.targetCustomer,
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
        targetCustomer: intro.targetCustomer,
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

  // Arc persistence: each time a new episode skeleton lands, PATCH the
  // playthrough so we have the arc on the server (for replay, share cards,
  // analytics). One write per episode; per-scene data already lives in
  // scene_events. Base64 imageUrls are stripped — they're a runtime concern
  // and would otherwise inflate the row by ~100KB per scene.
  useEffect(() => {
    if (!playthroughId) return;
    if (!arc) return;
    const skeleton = arc.arcSkeleton;
    if (!skeleton) return;
    if (arcPersistedRef.current === skeleton.episodeIndex) return;
    arcPersistedRef.current = skeleton.episodeIndex;

    const arcForWire = {
      ...arc,
      scenes: arc.scenes.map(({ imageUrl: _imageUrl, ...rest }) => rest),
    };

    fetch(`/api/playthroughs/${playthroughId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ arcJson: arcForWire }),
    }).catch((err) => console.error("persistArc failed", err));
  }, [playthroughId, arc]);

  // Image generation watcher: any LLM scene with text but no imageUrl gets
  // its gpt-image-2 render kicked off. Runs in parallel with scene/audio gen
  // so the image lands while the player is reading prior dialogue. Failures
  // are silent — the placeholder background stays in place.
  useEffect(() => {
    const scenes = arc?.scenes;
    if (!scenes) return;
    scenes.forEach((scene, idx) => {
      if (!scene || scene.dialogue.length === 0) return;
      if (scene.imageUrl) return;
      if (!scene.imagePrompt) return;
      if (imageGenFiredRef.current.has(idx)) return;
      imageGenFiredRef.current.add(idx);

      fetch("/api/generate-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "scene",
          scenePrompt: scene.imagePrompt,
          archetype: scene.archetype,
          quality: "medium",
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: { dataUrl?: string }) => {
          if (data.dataUrl) sceneImageReady(idx, data.dataUrl);
        })
        .catch((err) => {
          // Allow a retry on the next scene-state change.
          imageGenFiredRef.current.delete(idx);
          console.error(`generate-image[${idx}] failed`, err);
        });
    });
  }, [arc?.scenes, sceneImageReady]);

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
        targetCustomer: intro.targetCustomer,
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
        targetCustomer: intro.targetCustomer,
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

    // Paywall verify auto-issued a session cookie a few seconds ago — re-probe
    // /api/auth/me so the ending screen can show "Past flights" without a
    // full reload. setState happens after the async fetch resolves, not in
    // the effect body, so the lint rule's worry about cascading renders
    // doesn't apply here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSessionEmail();

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
    fetchSessionEmail,
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
      // CTA-only scenes (Scene 3 — the dare → paywall) have no `choices`
      // array; the click is a stat-neutral commit, labelled by the CTA copy.
      // Without this fallback, handleChoice silently bails and the player
      // can never advance past the paywall scene.
      if (!choice && !currentScene.ctaLabel) return;
      const choiceLabel = choice?.label ?? currentScene.ctaLabel ?? choiceId;
      const hypeDelta = choice?.hype ?? 0;
      const integrityDelta = choice?.integrity ?? 0;
      chooseOption(choiceId, choiceLabel, hypeDelta, integrityDelta);

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
        case "targetCustomer":
          updates.targetCustomer = text;
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
          maxLength={600}
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
              The city&apos;s still loading.
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

      {/*
        Top-right "Past flights" pill — appears whenever a player is logged in,
        EXCEPT on welcome (already linked there), paywall (don't interrupt
        payment), and ending (its own CTA covers it). Sits above the
        GameShell header so it overlays the cinematic without nudging layout.
      */}
      {sessionEmail &&
        phase !== "welcome" &&
        phase !== "paywall" &&
        phase !== "ending" && (
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="fixed top-5 right-6 z-30 comic-outline-sm font-sans font-semibold rounded-md px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] hover:no-underline"
            style={{
              background: "var(--color-fog)",
              color: "var(--color-ink)",
            }}
          >
            Past flights →
          </button>
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
