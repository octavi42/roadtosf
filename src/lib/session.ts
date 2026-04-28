import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  ArcSkeleton,
  DialogueLine,
  EndingKey,
  Scene,
  SceneOutline,
  StoryArc,
} from "./types";
import type { RolledCameo, ToneId } from "./cameos/types";
import type { StoryletState } from "./storylets/types";

// Phase no longer includes "paywall" — the paywall is now an overlay
// (paywallOpen: boolean) that floats on top of whatever phase the player
// is in. Driven by /api/generate-scene 402 responses, not by scene index,
// so a returning user with credits walks straight from scene 2 to scene 3
// and a new user only meets the paywall when the LLM tail can't fund a
// group it's about to generate.
export type Phase =
  | "welcome"
  | "scene"
  | "generating-arc"
  | "ending";

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
/**
 * First sceneIndex at which all QA-driven player facts (team, fundingModel,
 * stage, targetCustomer, concern) are guaranteed captured. Arc-gen and
 * scene-gen must not fire before this — Sonnet would otherwise see a
 * half-populated facts block and invent contradictions (the Maya bleed).
 * QA lives at sceneIndex 3, so 4 is the first scene safe for LLM kickoff.
 */
export const POST_QA_SCENE_INDEX = 4;
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
  /**
   * Number of LLM-generated groups (each = 4 sub-scenes sharing one image)
   * the user can still spawn. Server is authoritative; this field mirrors
   * the value returned by /api/credits/balance and the creditsRemaining
   * field on /api/generate-scene responses. Hits 0 → next group attempt
   * triggers paywall via creditsExhausted().
   */
  creditsRemaining: number;
  /**
   * Mirror of /api/auth/me's `email` field — null when the user is not
   * logged in. Lives in zustand (instead of page.tsx local state) so any
   * code path that changes auth (LoginModal success, /history logout) can
   * fan-out to the balance refetch effect by simply updating this value.
   * NOT persisted: the source of truth is the iron-session cookie.
   */
  sessionEmail: string | null;
  /**
   * The paywall is a modal overlay, not a phase. Set true when a generation
   * call returns 402 (creditsExhausted) or by the dev tools for testing.
   * Independent of `phase` so opening it doesn't disrupt the underlying
   * scene/generating-arc state — when the user pays, paywallSatisfied
   * closes the overlay and the existing flow resumes from where it was.
   */
  paywallOpen: boolean;
  // Tracks which sceneIndex already fired its share moment in the current
  // episode. Reset to null on each new arc skeleton (= new episode) and on
  // reset. Acts both as the per-episode frequency cap (max 1) and the
  // already-shown guard for the current scene.
  shareMomentFiredInEpisode: number | null;
  markShareMomentFired: (sceneIndex: number) => void;

  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  setPlaythroughId: (id: string | undefined) => void;
  setCreditsRemaining: (n: number) => void;
  setSessionEmail: (email: string | null) => void;
  setPaywallOpen: (open: boolean) => void;
  decrementCredits: (n?: number) => void;
  /**
   * Called when /api/generate-scene returns 402 (server-side debit found
   * an empty balance). Opens the paywall overlay and zeroes the local
   * mirror so the widget reflects the depleted state behind the modal.
   */
  creditsExhausted: () => void;
  devGrantCredits: (n: number) => void;
  welcomeStarted: () => void;
  captureIntro: (updates: Partial<IntroData>) => void;
  factsExtracted: (payload: {
    extracted: Partial<IntroData>;
    missing: MissingQuestion[];
  }) => void;
  paywallSatisfied: (creditsGranted?: number) => void;
  arcReady: (arc: StoryArc) => void;
  arcSkeletonReady: (
    skeleton: ArcSkeleton,
    fate?: { storyletState?: StoryletState },
  ) => void;
  /**
   * Replace one scene outline + storylet state in the current arc
   * skeleton. Used by the choice-responsive re-selection flow: when
   * the player completes a group's last sub-scene, /api/storylet/next
   * picks the next storylet given updated stats/flags, and this
   * action surgically updates only the upcoming group's outline
   * (not the others). Preserves the rest of the skeleton.
   */
  replaceOutline: (
    groupIndex: number,
    outline: SceneOutline,
    storyletState: StoryletState,
  ) => void;
  /**
   * Sets the per-run "fate" — rolled cameos + tone — once after intro
   * extraction settles. Idempotent: subsequent calls during the same run
   * are ignored so re-renders don't change the seed.
   */
  setRunFate: (payload: { rolledCameos: RolledCameo[]; tone: ToneId }) => void;
  dynamicSceneReady: (llmIndex: number, scene: Scene) => void;
  sceneImageReady: (llmIndex: number, imageUrl: string) => void;
  /**
   * Streaming scene-gen — set the imagePrompt as soon as it streams in
   * (before dialogue / choices arrive) so /api/generate-image can
   * fire ~5s earlier than waiting for the full scene response. Creates
   * a stub scene at llmIndex if none exists. No-op if a scene with
   * dialogue already exists at llmIndex (can't downgrade).
   */
  setSceneImagePrompt: (llmIndex: number, imagePrompt: string) => void;
  /**
   * Streaming scene-gen — append one dialogue line to the scene at
   * llmIndex as the line arrives over SSE. Creates a stub scene if
   * none exists. The DialogueSubtitle + useDialogueAudio hooks pick
   * up the new line automatically and start TTS / playback —
   * cutting perceived latency from ~5-7s (full scene wait) to ~1-1.5s
   * (first line streamed in).
   */
  appendDialogueLine: (llmIndex: number, line: DialogueLine) => void;
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
  /**
   * Resets the in-progress playthrough so a fresh run can start, but
   * deliberately preserves identity + payment state (paid, creditsRemaining,
   * sessionEmail, paywallOpen). Used by the end-of-game "play again" CTA
   * and the dev SKIP ONBOARDING shortcut — both expect credits to carry
   * over to the new run.
   */
  reset: () => void;
  /**
   * Total wipe — playthrough, identity, payment. The dev WIPE SESSION
   * button. Should not be wired into normal user flows.
   */
  wipeAll: () => void;
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
      creditsRemaining: 0,
      sessionEmail: null,
      paywallOpen: false,
      shareMomentFiredInEpisode: null,

      markShareMomentFired: (sceneIndex) =>
        set({ shareMomentFiredInEpisode: sceneIndex }),

      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      setPlaythroughId: (id) => set({ playthroughId: id }),
      setCreditsRemaining: (n) => set({ creditsRemaining: Math.max(0, n) }),
      setSessionEmail: (email) => set({ sessionEmail: email }),
      setPaywallOpen: (open) => set({ paywallOpen: open }),
      decrementCredits: (n = 1) =>
        set((state) => ({
          creditsRemaining: Math.max(0, state.creditsRemaining - Math.max(0, n)),
        })),
      creditsExhausted: () =>
        set((state) => {
          if (state.paywallOpen) return state;
          return { paywallOpen: true, creditsRemaining: 0 };
        }),
      devGrantCredits: (n) =>
        set((state) => ({
          paid: true,
          creditsRemaining: state.creditsRemaining + Math.max(0, n),
        })),

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

      setRunFate: ({ rolledCameos, tone }) =>
        set((state) => {
          // Idempotent: never overwrite once set, so re-renders / strict-mode
          // double-fires don't reroll the seed mid-run.
          if (state.arc?.rolledCameos && state.arc?.tone) return state;
          if (state.arc) {
            return {
              arc: {
                ...state.arc,
                rolledCameos,
                tone,
              },
            };
          }
          // No arc yet (rolling fires after intro extraction, before
          // arc-skeleton lands). Create a minimal stub; arcSkeletonReady's
          // merge branch will pick up these fields when the skeleton arrives.
          return {
            arc: {
              startupName: state.intro.startupName ?? "the startup",
              founderPersona: state.intro.selfDescription ?? "",
              stage: state.intro.stage,
              flavorTags: state.intro.flavorTags,
              scenes: [],
              stats: {
                firedCofounder: false,
                tookVCMoney: false,
                leakedToPress: false,
                playedSafeDemoDay: false,
              },
              rolledCameos,
              tone,
            },
          };
        }),

      arcSkeletonReady: (skeleton, fate) =>
        set((state) => {
          // Episode 0+: replace current skeleton; episodes 1+ also update the
          // rolling storySoFar that the next scene calls will reference.
          const nextStorySoFar = skeleton.storySoFar ?? state.arc?.storySoFar;
          // Storylet engine state: the server returns the updated state
          // alongside the skeleton (cooldowns + flags carried forward).
          // Falls back to the prior arc's state when the SSE done event
          // didn't include it (legacy fallback path).
          const nextStoryletState =
            fate?.storyletState ?? state.arc?.storyletState;
          // New episode → reset the per-episode share-moment cap.
          if (!state.arc) {
            return {
              shareMomentFiredInEpisode: null,
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
                storyletState: nextStoryletState,
              },
            };
          }
          return {
            shareMomentFiredInEpisode: null,
            arc: {
              ...state.arc,
              arcSkeleton: skeleton,
              storySoFar: nextStorySoFar,
              storyletState: nextStoryletState,
            },
          };
        }),

      replaceOutline: (groupIndex, outline, storyletState) =>
        set((state) => {
          // No arc / no skeleton means there's nothing to replace —
          // ignore. (This shouldn't happen in practice; the route is
          // gated on arc state in the caller.)
          if (!state.arc?.arcSkeleton) return state;
          const scenes = [...state.arc.arcSkeleton.scenes];
          // Find by .index (preferred) and fall back to array position.
          // Outlines are emitted with `index: 0..4`; preserving that
          // index in the replacement keeps downstream readers happy.
          const targetPos = scenes.findIndex((s) => s.index === groupIndex);
          const pos = targetPos >= 0 ? targetPos : groupIndex;
          if (pos < 0 || pos >= scenes.length) return state;
          scenes[pos] = { ...outline, index: groupIndex };
          return {
            arc: {
              ...state.arc,
              arcSkeleton: { ...state.arc.arcSkeleton, scenes },
              storyletState,
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

      setSceneImagePrompt: (llmIndex, imagePrompt) =>
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
          const prior = scenes[llmIndex]!;
          // Don't downgrade — once a real scene with imagePrompt exists,
          // skip. Streams sometimes deliver imagePrompt twice in racy
          // re-renders; this keeps the first stable.
          if (prior.imagePrompt && prior.imagePrompt.length > 0) return state;
          scenes[llmIndex] = { ...prior, imagePrompt };
          return { arc: { ...state.arc, scenes } };
        }),

      appendDialogueLine: (llmIndex, line) =>
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
          const prior = scenes[llmIndex]!;
          scenes[llmIndex] = { ...prior, dialogue: [...prior.dialogue, line] };
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
          // No more scene-2 paywall gate — the paywall is now driven by
          // /api/generate-scene 402s only. A new user walks free through
          // scenes 0–7 (authored) and hits the paywall the first time the
          // LLM tail can't fund a group it's about to generate.
          if (currentIndex === AUTHORED_SCENE_COUNT - 1) {
            return { phase: "generating-arc", progress: nextProgress };
          }
          return { progress: nextProgress };
        }),

      paywallSatisfied: (creditsGranted = 0) =>
        set((state) => {
          // Close the overlay regardless of phase — the user paid, they're
          // free to keep playing wherever they were. paid stays true once
          // set so the widget keeps surfacing post-purchase even at
          // creditsRemaining=0.
          return {
            paywallOpen: false,
            paid: true,
            creditsRemaining: state.creditsRemaining + Math.max(0, creditsGranted),
          };
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
          shareMomentFiredInEpisode: null,
          // paid, creditsRemaining, sessionEmail, paywallOpen preserved
          // — those belong to the player, not the run.
        }),

      wipeAll: () =>
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
          creditsRemaining: 0,
          sessionEmail: null,
          paywallOpen: false,
          shareMomentFiredInEpisode: null,
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
        // imageUrls are now short Vercel Blob URLs (a few hundred bytes), so
        // they fit in sessionStorage and survive rehydrate without re-firing
        // image-gen.
        arc: state.arc,
        progress: state.progress,
        history: state.history,
        stats: state.stats,
        ending: state.ending,
        playthroughId: state.playthroughId,
        paid: state.paid,
        creditsRemaining: state.creditsRemaining,
        paywallOpen: state.paywallOpen,
        shareMomentFiredInEpisode: state.shareMomentFiredInEpisode,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
