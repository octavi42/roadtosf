import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  Beat,
  DialogueLine,
  EndingKey,
  Episode,
  Scene,
  StoryArc,
} from "./types";
import type { RolledCameo, ToneId } from "./cameos/types";

// Phase no longer includes "paywall" — the paywall is now an overlay
// (paywallOpen: boolean) that floats on top of whatever phase the player
// is in. Driven by /api/generate-episode 402 responses (1 credit / episode),
// so a returning user with credits walks straight from episode N-1 to N
// and a new user only meets the paywall when the planner can't fund a
// new episode.
export type Phase =
  | "welcome"
  | "scene"
  | "generating-episode"
  | "ending";

/**
 * Authored scenes (src/lib/scenes.ts) cover indices 0..AUTHORED_SCENE_COUNT-1:
 *   0–2 pre-paywall (FaceTime with Jordan)
 *   3   post-paywall Q&A (the car ride)
 *   4–7 cinematic interlude — narrator-led, one shared pre-gen image
 * After that, the LLM tail runs *unbounded* — episodes of 3–5 scenes,
 * one Sonnet-planned episode at a time. Run ends when the player picks
 * "End my run" or via reset.
 */
export const AUTHORED_SCENE_COUNT = 8;
/**
 * First sceneIndex at which all QA-driven player facts (team, fundingModel,
 * stage, targetCustomer, concern) are guaranteed captured. Episode-gen
 * must not fire before this — Sonnet would otherwise see a half-populated
 * facts block and invent contradictions.
 * QA lives at sceneIndex 3, so 4 is the first scene safe for LLM kickoff.
 */
export const POST_QA_SCENE_INDEX = 4;
/** Min/max scenes per episode. The planner picks; we expect 3–5. */
export const EPISODE_LENGTH_MIN = 3;
export const EPISODE_LENGTH_MAX = 5;
/** Soft estimate used by UI bookkeeping that needs an upper bound. */
export const EPISODE_LENGTH_DEFAULT = EPISODE_LENGTH_MAX;

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
   * Called when /api/generate-episode returns 402 (server-side debit found
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
  /**
   * Episode planner produced a new Episode (theme + 3–5 scene plans
   * with cast / setting / imagePrompt). Replaces any prior currentEpisode
   * and resets the per-episode share-moment cap.
   */
  episodePlanReady: (
    episode: Episode,
    fate?: { firedSeedIds?: string[] },
  ) => void;
  /**
   * Sets the per-run "fate" — rolled cameos + tone — once after intro
   * extraction settles. Idempotent: subsequent calls during the same run
   * are ignored so re-renders don't change the seed.
   */
  setRunFate: (payload: { rolledCameos: RolledCameo[]; tone: ToneId }) => void;
  /**
   * Initialize the Scene records for the current episode from its
   * pre-fixed scene plans. Each plan becomes one slot in arc.scenes
   * with setting / cast / imagePrompt / role / title pre-populated;
   * dialogue + choices start empty and fill via appendBeat.
   */
  initScenesFromEpisode: () => void;
  /** Append one beat to the scene at globalLLMIndex. Beat dialogue
   *  is appended to the scene's accumulated dialogue; choices are
   *  REPLACED with the beat's; sceneClosed flips true if
   *  beat.isLastBeatOfScene; isLastSceneOfEpisode mirrors the beat's
   *  flag. Returns nothing — caller reads the new state. */
  appendBeat: (globalLLMIndex: number, beat: Beat) => void;
  sceneImageReady: (llmIndex: number, imageUrl: string) => void;
  /** Streaming: append one in-flight dialogue line to the scene's
   *  dialogue (the line is part of the IN-PROGRESS beat). Used by the
   *  SSE dialogueLine event so audio + subtitles can begin before
   *  `done` lands. The scene's dialogue grows; appendBeat's final
   *  pass dedupes / rebases by replacing the trailing partial range
   *  with the parsed canonical lines. */
  appendDialogueLine: (llmIndex: number, line: DialogueLine) => void;
  /** Reset the in-progress beat's partial dialogue so the next beat
   *  starts fresh. Called right before firing the next beat. */
  resetInFlightBeat: (globalLLMIndex: number) => void;
  setEpilogue: (epilogue: string) => void;
  enterGeneratingEpisode: () => void;
  exitGeneratingEpisode: () => void;
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
          // Clear run-scoped state defensively. Normally a fresh tab
          // starts with arc=undefined and history=[], but session-
          // storage hydration or partial resets could leave stale
          // scenes/history around — which would inflate
          // arc.scenes.length when episodePlanReady fires for episode
          // 0, producing wrong scene ids (saw "scene 13" instead of
          // "scene 9" once).
          return {
            phase: "scene",
            progress: INITIAL_PROGRESS,
            arc: undefined,
            history: [],
            stats: { hype: 0, integrity: 0 },
            ending: undefined,
            shareMomentFiredInEpisode: null,
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
          return {
            arc: {
              startupName: state.intro.startupName ?? "the startup",
              founderPersona: state.intro.selfDescription ?? "",
              stage: state.intro.stage,
              flavorTags: state.intro.flavorTags,
              episodeIndex: 0,
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

      episodePlanReady: (episode, fate) =>
        set((state) => {
          const nextStorySoFar = episode.storySoFar ?? state.arc?.storySoFar;
          const priorFired = state.arc?.firedSeedIds ?? [];
          const nextFired = fate?.firedSeedIds
            ? Array.from(new Set([...priorFired, ...fate.firedSeedIds]))
            : Array.from(new Set([...priorFired, ...episode.seedIds]));
          // Pre-fill arc.scenes with one slot per scene plan, so the
          // image-gen and player-flow effects can address scenes by
          // global llmIndex without waiting for the first beat to
          // populate the row.
          //
          // Guard against stale-state / double-fire: if the incoming
          // episodeIndex is not strictly greater than the prior arc's
          // episodeIndex, drop existing scenes. Otherwise a prior
          // playthrough's leftover scenes — or a duplicate
          // episodePlanReady for the same episode — would inflate
          // startLLMIndex and produce wrong scene ids.
          const priorEpisodeIndex = state.arc?.episodeIndex ?? -1;
          const isFreshOrDuplicate =
            state.arc != null && episode.episodeIndex <= priorEpisodeIndex;
          const priorScenes = isFreshOrDuplicate ? [] : state.arc?.scenes ?? [];
          const startLLMIndex = priorScenes.length;
          const stamped: Episode = { ...episode, startLLMIndex };
          const initializedSlots: Scene[] = stamped.scenes.map((plan, i) => ({
            id: AUTHORED_SCENE_COUNT + startLLMIndex + i + 1,
            title: plan.title,
            role: plan.role,
            archetype: plan.role,
            setting: plan.setting,
            cast: plan.cast,
            imagePrompt: plan.imagePrompt,
            dialogue: [],
            choices: [],
            timeoutSeconds: 15,
            timeoutChoiceId: "a",
            beatStarts: [0],
            sceneClosed: false,
            isLastSceneOfEpisode: false,
          }));
          const allScenes = [...priorScenes, ...initializedSlots];
          if (!state.arc) {
            return {
              shareMomentFiredInEpisode: null,
              arc: {
                startupName: state.intro.startupName ?? "the startup",
                founderPersona: state.intro.selfDescription ?? "",
                stage: state.intro.stage,
                flavorTags: state.intro.flavorTags,
                episodeIndex: episode.episodeIndex,
                currentEpisode: stamped,
                scenes: allScenes,
                storySoFar: nextStorySoFar,
                stats: {
                  firedCofounder: false,
                  tookVCMoney: false,
                  leakedToPress: false,
                  playedSafeDemoDay: false,
                },
                firedSeedIds: nextFired,
              },
            };
          }
          return {
            shareMomentFiredInEpisode: null,
            arc: {
              ...state.arc,
              episodeIndex: episode.episodeIndex,
              currentEpisode: stamped,
              scenes: allScenes,
              storySoFar: nextStorySoFar,
              firedSeedIds: nextFired,
            },
          };
        }),

      initScenesFromEpisode: () =>
        set((state) => {
          if (!state.arc?.currentEpisode) return state;
          const ep = state.arc.currentEpisode;
          const startLLM = ep.startLLMIndex ?? state.arc.scenes.length;
          const scenes = [...state.arc.scenes];
          for (let i = 0; i < ep.scenes.length; i++) {
            const slot = startLLM + i;
            const plan = ep.scenes[i];
            // If this slot already has dialogue (rehydrate / refire),
            // preserve the rendered scene; just ensure plan-derived
            // metadata (image, setting, cast, title, role) is filled
            // for the dev panel + image fan-out.
            const existing = scenes[slot];
            const baseScene: Scene = existing && existing.id !== 0
              ? existing
              : {
                  id: AUTHORED_SCENE_COUNT + slot + 1,
                  title: plan.title,
                  role: plan.role,
                  archetype: plan.role,
                  setting: plan.setting,
                  cast: plan.cast,
                  imagePrompt: plan.imagePrompt,
                  imageUrl: existing?.imageUrl,
                  dialogue: [],
                  choices: [],
                  timeoutSeconds: 15,
                  timeoutChoiceId: "a",
                  beatStarts: [0],
                  sceneClosed: false,
                  isLastSceneOfEpisode: false,
                };
            scenes[slot] = {
              ...baseScene,
              title: plan.title,
              role: plan.role,
              archetype: plan.role,
              setting: plan.setting,
              cast: plan.cast,
              imagePrompt: plan.imagePrompt,
            };
          }
          return { arc: { ...state.arc, scenes } };
        }),

      appendBeat: (llmIndex, beat) =>
        set((state) => {
          if (!state.arc) return state;
          const scenes = [...state.arc.scenes];
          if (!scenes[llmIndex]) return state;
          const prior = scenes[llmIndex];
          // Beat dialogue may already be partially appended via
          // streaming dialogueLine events. Rebase: trim back to the
          // start of the in-flight beat (beatStarts.last) and replace
          // with the canonical beat dialogue.
          const beatStarts = prior.beatStarts ?? [0];
          const lastBeatStart = beatStarts[beatStarts.length - 1] ?? 0;
          const dialogueBefore = prior.dialogue.slice(0, lastBeatStart);
          const dialogue = [...dialogueBefore, ...beat.dialogue];
          // Pivot overrides: on beat 0 of a non-zero scene index, the
          // LLM may emit setting/cast/title/role to override the plan.
          // Apply them to the Scene record so the dev panel + UI
          // reflect the actual scene the player is in.
          const beatAny = beat as unknown as {
            setting?: string | null;
            cast?: typeof prior.cast;
            role?: typeof prior.role;
            title?: string | null;
          };
          const overriddenSetting =
            typeof beatAny.setting === "string" && beatAny.setting.length > 0
              ? beatAny.setting
              : prior.setting;
          const overriddenCast =
            Array.isArray(beatAny.cast) && beatAny.cast.length > 0
              ? beatAny.cast
              : prior.cast;
          const overriddenRole = beatAny.role ?? prior.role;
          const overriddenTitle =
            typeof beatAny.title === "string" && beatAny.title.length > 0
              ? beatAny.title
              : prior.title;
          scenes[llmIndex] = {
            ...prior,
            setting: overriddenSetting,
            cast: overriddenCast,
            role: overriddenRole,
            archetype: overriddenRole,
            title: overriddenTitle,
            dialogue,
            choices: beat.choices,
            timeoutSeconds: beat.timeoutSeconds,
            timeoutChoiceId: beat.timeoutChoiceId,
            sceneClosed: !!beat.isLastBeatOfScene,
            isLastSceneOfEpisode: !!beat.isLastSceneOfEpisode,
            shareMoment: beat.shareMoment ?? prior.shareMoment,
          };
          // If this beat is for the scene the player is currently on,
          // reset their progress so they read the new dialogue lines.
          // BUT only if streaming-side progress reset hasn't already
          // fired (= choiceMade is still set). The streamed-first-line
          // path in appendDialogueLine clears choiceMade the moment
          // the first dialogueLine SSE event arrives — we don't want
          // appendBeat to bounce the player back to line 0 after they
          // have already started reading the streamed beat (this was
          // the "first text plays twice" bug).
          const playerLLMIndex =
            state.progress.sceneIndex - AUTHORED_SCENE_COUNT;
          const shouldResetProgress =
            playerLLMIndex === llmIndex && state.progress.choiceMade !== null;
          const progress = shouldResetProgress
            ? {
                ...state.progress,
                currentLineIndex: lastBeatStart,
                showChoices: false,
                choiceMade: null,
              }
            : state.progress;
          return { arc: { ...state.arc, scenes }, progress };
        }),

      appendDialogueLine: (llmIndex, line) =>
        set((state) => {
          if (!state.arc) return state;
          const scenes = [...state.arc.scenes];
          if (!scenes[llmIndex]) return state;
          const prior = scenes[llmIndex]!;
          const priorLen = prior.dialogue.length;
          scenes[llmIndex] = { ...prior, dialogue: [...prior.dialogue, line] };
          // If this is the FIRST line of an in-flight beat for the
          // player's current scene, reset progress immediately so the
          // narrator starts reading the new line as it streams. Without
          // this, the player sits on the post-choice waiting state until
          // the `done` event fires appendBeat (5–10s later) — the audio
          // plays only after the whole beat is generated, defeating the
          // purpose of SSE streaming.
          //
          // Detection: a new beat was just started by resetInFlightBeat,
          // which pushed beatStarts[last] = priorLen. So if priorLen ===
          // beatStarts.last AND this scene is the player's current
          // scene AND choiceMade is set (meaning we're between choice
          // and next beat landing), this is the first streamed line.
          const beatStarts = prior.beatStarts ?? [0];
          const lastBeatStart = beatStarts[beatStarts.length - 1] ?? 0;
          const playerLLMIndex =
            state.progress.sceneIndex - AUTHORED_SCENE_COUNT;
          const isFirstStreamLine =
            playerLLMIndex === llmIndex &&
            priorLen === lastBeatStart &&
            state.progress.choiceMade !== null;
          const progress = isFirstStreamLine
            ? {
                ...state.progress,
                currentLineIndex: lastBeatStart,
                showChoices: false,
                choiceMade: null,
              }
            : state.progress;
          return { arc: { ...state.arc, scenes }, progress };
        }),

      resetInFlightBeat: (llmIndex) =>
        set((state) => {
          if (!state.arc) return state;
          const scenes = [...state.arc.scenes];
          if (!scenes[llmIndex]) return state;
          const prior = scenes[llmIndex]!;
          const beatStarts = prior.beatStarts ?? [0];
          // Mark the next beat's start at the current dialogue length;
          // the in-flight dialogueLine events will append from there.
          const newStarts = [...beatStarts, prior.dialogue.length];
          scenes[llmIndex] = {
            ...prior,
            beatStarts: newStarts,
            sceneClosed: false,
          };
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
              role: "cofounder",
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

      enterGeneratingEpisode: () =>
        set((state) => {
          if (state.phase === "generating-episode") return state;
          return { phase: "generating-episode" };
        }),

      exitGeneratingEpisode: () =>
        set((state) => {
          if (state.phase !== "generating-episode") return state;
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
          // /api/generate-episode 402s only. A new user walks free through
          // scenes 0–7 (authored) and hits the paywall the first time the
          // planner can't fund a new episode.
          if (currentIndex === AUTHORED_SCENE_COUNT - 1) {
            return { phase: "generating-episode", progress: nextProgress };
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
          if (phase === "generating-episode") {
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
      // Bump on architectural breaks. v3 = multi-beat scenes (pre-fixed
      // ScenePlans + Beats accumulated inside scene containers).
      // Persisted v1/v2 state has incompatible Episode shape (v1
      // ArcSkeleton; v2 lightweight Episode with arcBullets but no
      // scenes[]). Hard reset for either.
      version: 3,
      migrate: (persisted, fromVersion) => {
        if (fromVersion < 3) {
          const p = (persisted ?? {}) as Partial<SessionState>;
          return {
            phase: "welcome",
            intro: INITIAL_INTRO,
            arc: undefined,
            progress: INITIAL_PROGRESS,
            history: [],
            stats: { hype: 0, integrity: 0 },
            ending: undefined,
            playthroughId: undefined,
            paid: p.paid ?? false,
            creditsRemaining: p.creditsRemaining ?? 0,
            paywallOpen: false,
            shareMomentFiredInEpisode: null,
          } as Partial<SessionState>;
        }
        return persisted as Partial<SessionState>;
      },
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
