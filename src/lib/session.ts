import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EndingKey, StoryArc } from "./types";

export type Phase =
  | "welcome"
  | "api-keys"
  | "onboarding"
  | "scene"
  | "ending";

export interface IntroData {
  transcript: string;
  startupName?: string;
  startupDescription?: string;
  selfDescription?: string;
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

  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  setPlaythroughId: (id: string | undefined) => void;
  welcomeStarted: () => void;
  keysConfirmed: () => void;
  introSubmitted: (
    transcript: string,
    extracted?: Partial<Omit<IntroData, "transcript">>,
  ) => void;
  arcReady: (arc: StoryArc) => void;
  advanceLine: (totalLines: number) => void;
  chooseOption: (
    choiceId: string,
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

      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      setPlaythroughId: (id) => set({ playthroughId: id }),

      welcomeStarted: () =>
        set((state) => {
          if (state.phase !== "welcome") return state;
          return { phase: "api-keys" };
        }),

      keysConfirmed: () =>
        set((state) => {
          if (state.phase !== "api-keys") return state;
          return { phase: "onboarding" };
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

      arcReady: (arc) => set({ arc }),

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

      chooseOption: (choiceId, hypeDelta, integrityDelta, timedOut = false) =>
        set((state) => {
          if (state.phase !== "scene") return state;
          if (state.progress.choiceMade !== null) return state;
          const sceneId = state.progress.sceneIndex + 1;
          return {
            history: [
              ...state.history,
              { sceneId, choiceId, timedOut, hypeDelta, integrityDelta },
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
          return {
            progress: {
              sceneIndex: nextIndex,
              currentLineIndex: 0,
              showChoices: false,
              choiceMade: null,
            },
          };
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
        }),
    }),
    {
      name: "roadtosf-session",
      // TEMP: persistence disabled while iterating on the welcome screen.
      // Restore by swapping storage back to sessionStorage and removing the noop.
      storage: createJSONStorage(() => ({
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      })),
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
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
