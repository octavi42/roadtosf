import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ArcSkeleton, EndingKey, Scene, StoryArc } from "./types";

export type Phase =
  | "welcome"
  | "onboarding"
  | "scene"
  | "paywall"
  | "generating-arc"
  | "ending";

/**
 * Paywall fires when this scene index has just been completed
 * (i.e. the wall sits between scene N+1 and scene N+2 in player-facing terms).
 * Single source of truth — move this to shift the wall.
 */
export const PAYWALL_AFTER_SCENE_INDEX = 2;

/**
 * Authored scenes (src/lib/scenes.ts) cover indices 0..AUTHORED_SCENE_COUNT-1.
 * After that the LLM tail takes over and runs for LLM_SCENE_COUNT scenes.
 * Total playthrough = AUTHORED + LLM scenes.
 */
export const AUTHORED_SCENE_COUNT = 5;
export const LLM_SCENE_COUNT = 5;
export const TOTAL_SCENE_COUNT = AUTHORED_SCENE_COUNT + LLM_SCENE_COUNT;

export interface IntroData {
  transcript: string;
  startupName?: string;
  startupDescription?: string;
  selfDescription?: string;
  stage?: string;
  flavorTags: string[];
}

export interface SceneProgress {
  sceneIndex: number;
  currentLineIndex: number;
  showChoices: boolean;
  choiceMade: string | null;
}

export interface SceneOutcome {
  sceneId: number;
  choiceId: string;
  choiceLabel: string;
  timedOut: boolean;
  hypeDelta: number;
  integrityDelta: number;
}

export interface EndingData {
  key: EndingKey;
  epilogue?: string;
  achievementsUnlocked: string[];
}

interface SessionState {
  phase: Phase;
  intro: IntroData;
  arc?: StoryArc;
  progress: SceneProgress;
  history: SceneOutcome[];
  stats: { hype: number; integrity: number };
  ending?: EndingData;
  playthroughId?: string;
  paid: boolean;

  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  setPlaythroughId: (id: string | undefined) => void;
  welcomeStarted: () => void;
  introSubmitted: (
    transcript: string,
    extracted?: Partial<Omit<IntroData, "transcript">>,
  ) => void;
  captureIntro: (updates: Partial<IntroData>) => void;
  paywallSatisfied: () => void;
  arcReady: (arc: StoryArc) => void;
  arcSkeletonReady: (skeleton: ArcSkeleton) => void;
  dynamicSceneReady: (llmIndex: number, scene: Scene) => void;
  setEpilogue: (epilogue: string) => void;
  enterGeneratingArc: () => void;
  exitGeneratingArc: () => void;
  devSetPhase: (phase: Phase, sceneIndex?: number) => void;
  advanceLine: (totalLines: number) => void;
  chooseOption: (
    choiceId: string,
    choiceLabel: string,
    hypeDelta: number,
    integrityDelta: number,
    timedOut?: boolean,
  ) => void;
  advanceScene: (totalScenes: number) => void;
  reset: () => void;
}

const INITIAL_INTRO: IntroData = {
  transcript: "",
  flavorTags: [],
};

const INITIAL_PROGRESS: SceneProgress = {
  sceneIndex: 0,
  currentLineIndex: 0,
  showChoices: false,
  choiceMade: null,
};

function classifyEnding(hype: number, integrity: number): EndingKey {
  const magnitude = Math.abs(hype) + Math.abs(integrity);
  if (magnitude < 3) return "ghosted";
  if (hype >= 2 && integrity >= 2) return "ipo";
  if (hype >= 2 && integrity < 0) return "indicted";
  if (hype < 0 && integrity >= 2) return "ai-wrapper";
  if (hype < 0 && integrity < 0) return "acquihire";
  return "ghosted";
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      phase: "welcome",
      intro: INITIAL_INTRO,
      arc: undefined,
      progress: INITIAL_PROGRESS,
      history: [],
      stats: { hype: 0, integrity: 0 },
      ending: undefined,
      paid: false,

      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      setPlaythroughId: (id) => set({ playthroughId: id }),

      welcomeStarted: () =>
        set((state) => {
          if (state.phase !== "welcome") return state;
          return { phase: "scene", progress: INITIAL_PROGRESS };
        }),

      introSubmitted: (transcript, extracted) =>
        set((state) => {
          if (state.phase !== "onboarding") return state;
          return {
            phase: "scene",
            progress: INITIAL_PROGRESS,
            intro: {
              ...state.intro,
              transcript,
              ...extracted,
              flavorTags: extracted?.flavorTags ?? state.intro.flavorTags,
            },
          };
        }),

      captureIntro: (updates) =>
        set((state) => ({
          intro: {
            ...state.intro,
            ...updates,
            transcript:
              updates.transcript !== undefined
                ? `${state.intro.transcript}${state.intro.transcript ? "\n" : ""}${updates.transcript}`
                : state.intro.transcript,
            flavorTags: updates.flavorTags
              ? Array.from(
                  new Set([...state.intro.flavorTags, ...updates.flavorTags]),
                )
              : state.intro.flavorTags,
          },
        })),

      arcReady: (arc) => set({ arc }),

      arcSkeletonReady: (skeleton) =>
        set((state) => {
          if (!state.arc) {
            return {
              arc: {
                startupName: state.intro.startupName ?? "the startup",
                founderPersona: state.intro.selfDescription ?? "",
                stage: state.intro.stage,
                flavorTags: state.intro.flavorTags,
                arcSkeleton: skeleton,
                scenes: [],
                stats: {
                  firedCofounder: false,
                  tookVCMoney: false,
                  leakedToPress: false,
                  playedSafeDemoDay: false,
                },
              },
            };
          }
          return { arc: { ...state.arc, arcSkeleton: skeleton } };
        }),

      dynamicSceneReady: (llmIndex, scene) =>
        set((state) => {
          if (!state.arc) return state;
          const scenes = [...state.arc.scenes];
          while (scenes.length <= llmIndex) {
            scenes.push({
              id: 0,
              title: "",
              archetype: "cofounder",
              imagePrompt: "",
              dialogue: [],
              choices: [],
              timeoutSeconds: 15,
              timeoutChoiceId: "a",
            });
          }
          scenes[llmIndex] = scene;
          return { arc: { ...state.arc, scenes } };
        }),

      setEpilogue: (epilogue) =>
        set((state) => {
          if (!state.ending) return state;
          return { ending: { ...state.ending, epilogue } };
        }),

      enterGeneratingArc: () =>
        set((state) => {
          if (state.phase === "generating-arc") return state;
          return { phase: "generating-arc" };
        }),

      exitGeneratingArc: () =>
        set((state) => {
          if (state.phase !== "generating-arc") return state;
          return {
            phase: "scene",
            progress: {
              sceneIndex: AUTHORED_SCENE_COUNT,
              currentLineIndex: 0,
              showChoices: false,
              choiceMade: null,
            },
          };
        }),

      advanceLine: (totalLines) =>
        set((state) => {
          if (state.phase !== "scene") return state;
          if (state.progress.showChoices) return state;
          const nextLine = state.progress.currentLineIndex + 1;
          if (nextLine >= totalLines) {
            return {
              progress: { ...state.progress, showChoices: true },
            };
          }
          return {
            progress: { ...state.progress, currentLineIndex: nextLine },
          };
        }),

      chooseOption: (choiceId, choiceLabel, hypeDelta, integrityDelta, timedOut = false) =>
        set((state) => {
          if (state.phase !== "scene") return state;
          if (state.progress.choiceMade !== null) return state;
          const sceneId = state.progress.sceneIndex + 1;
          return {
            history: [
              ...state.history,
              {
                sceneId,
                choiceId,
                choiceLabel,
                timedOut,
                hypeDelta,
                integrityDelta,
              },
            ],
            stats: {
              hype: state.stats.hype + hypeDelta,
              integrity: state.stats.integrity + integrityDelta,
            },
            progress: { ...state.progress, choiceMade: choiceId },
          };
        }),

      advanceScene: (totalScenes) =>
        set((state) => {
          if (state.phase !== "scene") return state;
          const nextIndex = state.progress.sceneIndex + 1;
          if (nextIndex >= totalScenes) {
            return {
              phase: "ending",
              ending: {
                key: classifyEnding(state.stats.hype, state.stats.integrity),
                achievementsUnlocked: [],
              },
            };
          }
          const nextProgress = {
            sceneIndex: nextIndex,
            currentLineIndex: 0,
            showChoices: false,
            choiceMade: null,
          };
          // Paywall after the configured authored scene
          if (
            state.progress.sceneIndex === PAYWALL_AFTER_SCENE_INDEX &&
            !state.paid
          ) {
            return { phase: "paywall", progress: nextProgress };
          }
          // After the last authored scene, hand off to LLM via generating-arc
          if (state.progress.sceneIndex === AUTHORED_SCENE_COUNT - 1) {
            return { phase: "generating-arc", progress: nextProgress };
          }
          return { progress: nextProgress };
        }),

      paywallSatisfied: () =>
        set((state) => {
          if (state.phase !== "paywall") return state;
          return { phase: "scene", paid: true };
        }),

      devSetPhase: (phase, sceneIndex = 0) =>
        set((state) => {
          if (phase === "scene") {
            return {
              phase,
              progress: {
                sceneIndex,
                currentLineIndex: 0,
                showChoices: false,
                choiceMade: null,
              },
              ending: undefined,
            };
          }
          if (phase === "paywall") {
            return {
              phase,
              progress: {
                sceneIndex: PAYWALL_AFTER_SCENE_INDEX + 1,
                currentLineIndex: 0,
                showChoices: false,
                choiceMade: null,
              },
              ending: undefined,
            };
          }
          if (phase === "generating-arc") {
            return {
              phase,
              progress: {
                sceneIndex: AUTHORED_SCENE_COUNT,
                currentLineIndex: 0,
                showChoices: false,
                choiceMade: null,
              },
              ending: undefined,
            };
          }
          if (phase === "ending") {
            return {
              phase,
              ending:
                state.ending ?? { key: "ipo", achievementsUnlocked: [] },
            };
          }
          return { phase, ending: undefined };
        }),

      reset: () =>
        set({
          phase: "onboarding",
          intro: INITIAL_INTRO,
          arc: undefined,
          progress: INITIAL_PROGRESS,
          history: [],
          stats: { hype: 0, integrity: 0 },
          ending: undefined,
          playthroughId: undefined,
          paid: false,
        }),
    }),
    {
      name: "roadtosf-session",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? undefined! : sessionStorage,
      ),
      skipHydration: true,
      partialize: (state) => ({
        phase: state.phase,
        intro: state.intro,
        arc: state.arc,
        progress: state.progress,
        history: state.history,
        stats: state.stats,
        ending: state.ending,
        playthroughId: state.playthroughId,
        paid: state.paid,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
