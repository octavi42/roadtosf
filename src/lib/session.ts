import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ArcSkeleton, EndingKey, Scene, StoryArc } from "./types";

export type Phase =
  | "welcome"
  | "scene"
  | "paywall"
  | "generating-arc"
  | "ending";

/**
 * Paywall fires when this scene index has just been completed.
 */
export const PAYWALL_AFTER_SCENE_INDEX = 2;

/**
 * Authored scenes (src/lib/scenes.ts) cover indices 0..AUTHORED_SCENE_COUNT-1:
 *   0–2 pre-paywall (FaceTime with Jordan)
 *   3   post-paywall Q&A (the car ride)
 *   4–7 Group 1: "exploring SF" — narrator-led, one shared pre-gen image
 * After that, the LLM tail runs *unbounded* — generated 20 scenes at a time
 * (one episode = 5 archetype groups × 4 sub-scenes each, sharing one image
 * per group). Run ends when the player picks "End my run" or via reset.
 */
export const AUTHORED_SCENE_COUNT = 8;
/** Sub-scenes per archetype encounter; one image per group of this size. */
export const SCENES_PER_GROUP = 4;
/** Archetype outlines per arc skeleton (one per group within an episode). */
export const GROUPS_PER_EPISODE = 5;
export const EPISODE_LENGTH = SCENES_PER_GROUP * GROUPS_PER_EPISODE; // 20

export type MissingQuestionField =
  | "team"
  | "fundingModel"
  | "stage"
  | "targetCustomer"
  | "concern";

export interface MissingQuestion {
  field: MissingQuestionField;
  question: string;
}

export interface IntroData {
  transcript: string;
  startupName?: string;
  startupDescription?: string;
  selfDescription?: string;
  stage?: string;
  team?: string; // solo / cofounder name(s) / team
  fundingModel?: string; // raising / bootstrapping / runway
  targetCustomer?: string; // who the product is for — concrete characters for cameos
  concern?: string; // what's broken right now
  // Populated by /api/extract-facts after scene 2. Drives the dynamic Q&A in
  // scene 4. Empty array means "everything was already covered" and scene 4
  // auto-advances. Undefined means extraction hasn't run yet (or failed).
  missingQuestions?: MissingQuestion[];
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
  captureIntro: (updates: Partial<IntroData>) => void;
  factsExtracted: (payload: {
    extracted: Partial<IntroData>;
    missing: MissingQuestion[];
  }) => void;
  paywallSatisfied: () => void;
  arcReady: (arc: StoryArc) => void;
  arcSkeletonReady: (skeleton: ArcSkeleton) => void;
  dynamicSceneReady: (llmIndex: number, scene: Scene) => void;
  sceneImageReady: (llmIndex: number, imageUrl: string) => void;
  setEpilogue: (epilogue: string) => void;
  enterGeneratingArc: () => void;
  exitGeneratingArc: () => void;
  endRun: () => void;
  devSetPhase: (phase: Phase, sceneIndex?: number) => void;
  advanceLine: (totalLines: number) => void;
  chooseOption: (
    choiceId: string,
    choiceLabel: string,
    hypeDelta: number,
    integrityDelta: number,
    timedOut?: boolean,
  ) => void;
  advanceScene: () => void;
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

      factsExtracted: ({ extracted, missing }) =>
        set((state) => {
          // Only adopt extracted fields that are non-empty and not already
          // captured directly by the player. Player-typed answers always win.
          const patch: Partial<IntroData> = {};
          (
            [
              "team",
              "fundingModel",
              "stage",
              "targetCustomer",
              "concern",
            ] as const
          ).forEach((k) => {
            const v = extracted[k];
            if (typeof v === "string" && v.trim().length > 0 && !state.intro[k]) {
              patch[k] = v.trim();
            }
          });
          return {
            intro: {
              ...state.intro,
              ...patch,
              missingQuestions: missing,
            },
          };
        }),

      arcReady: (arc) => set({ arc }),

      arcSkeletonReady: (skeleton) =>
        set((state) => {
          // Episode 0+: replace current skeleton; episodes 1+ also update the
          // rolling storySoFar that the next scene calls will reference.
          const nextStorySoFar = skeleton.storySoFar ?? state.arc?.storySoFar;
          if (!state.arc) {
            return {
              arc: {
                startupName: state.intro.startupName ?? "the startup",
                founderPersona: state.intro.selfDescription ?? "",
                stage: state.intro.stage,
                flavorTags: state.intro.flavorTags,
                arcSkeleton: skeleton,
                scenes: [],
                storySoFar: nextStorySoFar,
                stats: {
                  firedCofounder: false,
                  tookVCMoney: false,
                  leakedToPress: false,
                  playedSafeDemoDay: false,
                },
              },
            };
          }
          return {
            arc: {
              ...state.arc,
              arcSkeleton: skeleton,
              storySoFar: nextStorySoFar,
            },
          };
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
          // Preserve any imageUrl that landed before the scene text did.
          const prior = scenes[llmIndex];
          scenes[llmIndex] = prior?.imageUrl
            ? { ...scene, imageUrl: prior.imageUrl }
            : scene;
          return { arc: { ...state.arc, scenes } };
        }),

      sceneImageReady: (llmIndex, imageUrl) =>
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
          scenes[llmIndex] = { ...scenes[llmIndex], imageUrl };
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
          // First exit lands at the start of the *current* episode's first
          // scene. For episode 0 that's authored-scene-count; for later
          // episodes the player is already past it, so we stay where we are.
          const llmCount = state.arc?.scenes.length ?? 0;
          const targetIndex =
            llmCount === 0
              ? AUTHORED_SCENE_COUNT
              : state.progress.sceneIndex;
          return {
            phase: "scene",
            progress: {
              sceneIndex: targetIndex,
              currentLineIndex: 0,
              showChoices: false,
              choiceMade: null,
            },
          };
        }),

      endRun: () =>
        set((state) => ({
          phase: "ending",
          ending: {
            key: classifyEnding(state.stats.hype, state.stats.integrity),
            achievementsUnlocked: state.ending?.achievementsUnlocked ?? [],
          },
        })),

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

      advanceScene: () =>
        set((state) => {
          if (state.phase !== "scene") return state;
          const currentIndex = state.progress.sceneIndex;
          const nextIndex = currentIndex + 1;
          const nextProgress = {
            sceneIndex: nextIndex,
            currentLineIndex: 0,
            showChoices: false,
            choiceMade: null,
          };
          // Paywall after the configured authored scene
          if (currentIndex === PAYWALL_AFTER_SCENE_INDEX && !state.paid) {
            return { phase: "paywall", progress: nextProgress };
          }
          // After the last authored scene, hand off to LLM via generating-arc
          if (currentIndex === AUTHORED_SCENE_COUNT - 1) {
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
          phase: "welcome",
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
