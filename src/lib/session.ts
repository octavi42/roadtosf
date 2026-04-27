import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EndingKey, Group, StoryArc } from "./types";

export type Phase =
  | "api-keys"
  | "intro"
  | "generating"
  | "scene"
  | "twist-card"
  | "ending";

export interface IntroData {
  transcript: string;
  startupName?: string;
  startupDescription?: string;
  selfDescription?: string;
  flavorTags: string[];
}

export interface SceneProgress {
  groupIndex: number; // 0, 1, 2 — index into arc.groups[]
  sceneIndex: number; // index within the current group's scenes
  currentLineIndex: number;
  showChoices: boolean;
  choiceMade: string | null;
}

export interface SceneOutcome {
  groupIndex: number; // 1, 2, 3 — matches Group.id
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

  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  setPlaythroughId: (id: string | undefined) => void;
  keysConfirmed: () => void;
  introSubmitted: (
    transcript: string,
    extracted?: Partial<Omit<IntroData, "transcript">>,
  ) => void;
  enterScenes: () => void;
  arcReady: (arc: StoryArc) => void;
  groupReady: (groupIndex: number, group: Group) => void;
  enterTwistCard: () => void;
  exitTwistCard: () => void;
  advanceLine: (totalLines: number) => void;
  chooseOption: (
    choiceId: string,
    choiceLabel: string,
    hypeDelta: number,
    integrityDelta: number,
    timedOut?: boolean,
  ) => void;
  advanceScene: () => void;
  setEpilogue: (epilogue: string) => void;
  reset: () => void;
  devSetPhase: (phase: Phase, sceneIndex?: number, groupIndex?: number) => void;
}

const INITIAL_INTRO: IntroData = {
  transcript: "",
  flavorTags: [],
};

const INITIAL_PROGRESS: SceneProgress = {
  groupIndex: 0,
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
      phase: "api-keys",
      intro: INITIAL_INTRO,
      arc: undefined,
      progress: INITIAL_PROGRESS,
      history: [],
      stats: { hype: 0, integrity: 0 },
      ending: undefined,

      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      setPlaythroughId: (id) => set({ playthroughId: id }),

      keysConfirmed: () =>
        set((state) => {
          if (state.phase !== "api-keys") return state;
          return { phase: "intro" };
        }),

      introSubmitted: (transcript, extracted) =>
        set((state) => {
          if (state.phase !== "intro") return state;
          return {
            phase: "generating",
            intro: {
              ...state.intro,
              transcript,
              ...extracted,
              flavorTags: extracted?.flavorTags ?? state.intro.flavorTags,
            },
          };
        }),

      enterScenes: () =>
        set((state) => {
          if (state.phase !== "generating") return state;
          return { phase: "scene", progress: INITIAL_PROGRESS };
        }),

      arcReady: (arc) => set({ arc }),

      groupReady: (groupIndex, group) =>
        set((state) => {
          if (!state.arc) return state;
          const groups = [...state.arc.groups];
          // Pad with empty groups if needed so indexed assignment is safe.
          while (groups.length <= groupIndex) {
            groups.push({ id: groups.length + 1, twistCard: "", scenes: [], status: "pending" });
          }
          groups[groupIndex] = { ...group, status: "ready" };
          return { arc: { ...state.arc, groups } };
        }),

      enterTwistCard: () =>
        set((state) => {
          if (state.phase !== "scene") return state;
          return { phase: "twist-card" };
        }),

      exitTwistCard: () =>
        set((state) => {
          if (state.phase !== "twist-card") return state;
          if (!state.arc) return state;
          const nextGroupIndex = state.progress.groupIndex + 1;
          if (nextGroupIndex >= state.arc.groups.length) {
            return {
              phase: "ending",
              ending: {
                key: classifyEnding(state.stats.hype, state.stats.integrity),
                achievementsUnlocked: [],
              },
            };
          }
          return {
            phase: "scene",
            progress: {
              groupIndex: nextGroupIndex,
              sceneIndex: 0,
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
          const group = state.arc?.groups[state.progress.groupIndex];
          const scene = group?.scenes[state.progress.sceneIndex];
          if (!scene) return state;
          return {
            history: [
              ...state.history,
              {
                groupIndex: group.id,
                sceneId: scene.id,
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

      advanceScene: () =>
        set((state) => {
          if (state.phase !== "scene") return state;
          if (!state.arc) return state;
          const group = state.arc.groups[state.progress.groupIndex];
          if (!group) return state;
          const nextSceneIndex = state.progress.sceneIndex + 1;
          if (nextSceneIndex >= group.scenes.length) {
            return { phase: "twist-card" };
          }
          return {
            progress: {
              ...state.progress,
              sceneIndex: nextSceneIndex,
              currentLineIndex: 0,
              showChoices: false,
              choiceMade: null,
            },
          };
        }),

      setEpilogue: (epilogue) =>
        set((state) => {
          if (!state.ending) return state;
          return { ending: { ...state.ending, epilogue } };
        }),

      reset: () =>
        set({
          phase: "intro",
          intro: INITIAL_INTRO,
          arc: undefined,
          progress: INITIAL_PROGRESS,
          history: [],
          stats: { hype: 0, integrity: 0 },
          ending: undefined,
          playthroughId: undefined,
        }),

      devSetPhase: (phase, sceneIndex = 0, groupIndex = 0) =>
        set((state) => {
          if (phase === "scene") {
            return {
              phase,
              progress: {
                groupIndex,
                sceneIndex,
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
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
