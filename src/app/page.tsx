"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { GameShell } from "@/components/GameShell";
import ChoicePanel from "@/components/ChoicePanel";
import TextInputPanel from "@/components/TextInputPanel";
import DialogueSubtitle from "@/components/DialogueSubtitle";
import DialogueSpeaker from "@/components/DialogueSpeaker";
import NarratorLobby from "@/components/NarratorLobby";
import PaywallPanel from "@/components/PaywallPanel";
import LoginModal from "@/components/LoginModal";
import { ShareNotification } from "@/components/ShareNotification";
import EndingFateCard from "@/components/EndingFateCard";
import {
  useSessionStore,
  AUTHORED_SCENE_COUNT,
  EPISODE_LENGTH_DEFAULT,
  POST_QA_SCENE_INDEX,
} from "@/lib/session";
import { ARCHETYPES } from "@/lib/archetypes";
import {
  voiceIdForSpeaker,
  voiceIdForCastMember,
  NARRATOR_VOICE_ID,
} from "@/lib/voices/speaker";
import type {
  EndingKey,
  Episode,
  Scene as LLMScene,
  ShareMoment,
} from "@/lib/types";
import { fetchEpisode, type FetchEpisodeResult } from "@/lib/streamEpisode";
import { streamScene } from "@/lib/streamScene";
import { PaywallRequiredError } from "@/lib/paywall";
import { rollCameos } from "@/lib/cameos/roll";
import { rollTone } from "@/lib/cameos/tone";
import type {
  IntroData,
  MissingQuestion,
  MissingQuestionField,
} from "@/lib/session";
import {
  SCENES,
  GROUP1_BACKGROUND,
  type SceneData,
  type DialogueLine as AuthoredDialogueLine,
  type Choice as AuthoredChoice,
} from "@/lib/scenes";

// WORLD voice cold-open. Implicates the player by name without predicting
// their failure: outcome stays uncertain, the player is the one who'll find
// out, and the Start CTA ("Show me →") is the player demanding the reveal.
const WELCOME_LINES = [
  "A few thousand people move to San Francisco every year to start a company.",
  "Some of them become legends.",
  "Most become a story other founders tell at dinner.",
  "Tonight, you find out which.",
];

const WELCOME_BACKGROUND = "/intro-v3/01-vision-board.png";

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

// Each unified dialogue line carries a pre-resolved voiceId. We resolve at
// unify-time because formatArchetypeSpeaker (below) collapses LLM speakers
// into display strings ("Stranger · Co-founder & CTO"), which makes
// after-the-fact archetype lookup brittle.
interface UnifiedDialogueLine extends AuthoredDialogueLine {
  voiceId?: string | null;
}

interface UnifiedScene {
  id: number;
  title: string;
  background?: string;
  dialogue: UnifiedDialogueLine[];
  choices?: AuthoredChoice[];
  textInput?: SceneData["textInput"];
  questions?: SceneData["questions"];
  // Authored-only — the single-CTA dare → paywall scene relies on this.
  // LLM scenes don't set it.
  ctaLabel?: string;
  isLLM: boolean;
  // LLM-only — emitted when the scene contains a shareable beat. Frequency
  // is capped client-side; see shareMomentFiredInEpisode in session.ts.
  shareMoment?: ShareMoment;
}

function formatRoleSpeaker(
  speaker: string,
  cast?: Array<{ role: string; name: string }>,
): string {
  if (speaker === "player") return "You";
  if (speaker === "narrator") return "";
  // Cast on the active scene plan wins — the LLM may have named this
  // role per-episode (e.g. "Peter Thiel" for the partner role).
  const fromCast = cast?.find((c) => c.role === speaker);
  if (fromCast) return `${fromCast.name} · ${ARCHETYPES[fromCast.role as keyof typeof ARCHETYPES]?.title ?? ""}`.trim();
  const def = ARCHETYPES[speaker as keyof typeof ARCHETYPES];
  if (!def) return speaker;
  // No canonical name anymore — fall back to the role label + title.
  return `${def.roleLabel} · ${def.title}`;
}

function adaptLLMScene(scene: LLMScene): UnifiedScene {
  return {
    id: scene.id,
    title: scene.title,
    // Generated scene image takes over once it lands. Until then,
    // fall back to GROUP1_BACKGROUND so the in-game loading state
    // shows a SF establishing frame instead of the cafe-planning
    // intro shot.
    background: scene.imageUrl ?? GROUP1_BACKGROUND,
    dialogue: scene.dialogue.map((d) => ({
      speaker: formatRoleSpeaker(d.speaker, scene.cast),
      text: d.text,
      voiceId: voiceIdForCastMember(d.speaker, scene.cast),
    })),
    choices: scene.choices.map((c) => ({
      id: c.id,
      label: c.label,
      hype: c.hype,
      integrity: c.integrity,
    })),
    isLLM: true,
    shareMoment: scene.shareMoment,
  };
}

// Show the "End my run" exit only after the player has finished one full LLM
// episode. Keeps short runs from ending prematurely. Uses the upper-bound
// episode length so we don't surface "End my run" mid-first-episode if the
// planner picks 5 scenes.
const END_RUN_VISIBLE_FROM_SCENE_INDEX =
  AUTHORED_SCENE_COUNT + EPISODE_LENGTH_DEFAULT;

function authoredAsUnified(scene: SceneData): UnifiedScene {
  return {
    id: scene.id,
    title: scene.title,
    background: scene.background,
    dialogue: scene.dialogue.map((d) => ({
      ...d,
      voiceId: voiceIdForSpeaker(d.speaker),
    })),
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

// 75s gives Sonnet headroom for the full episode plan + cast identity
// fields. Was 45s, which started timing out after PR2/3 added per-cast
// gender/age/descriptives/appearance to the episode-level output.
const EPISODE_GEN_TIMEOUT_MS = 75000;

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
    if (res.status === 402) {
      let parsed: { creditsRemaining?: number } = {};
      try {
        parsed = (await res.json()) as { creditsRemaining?: number };
      } catch {
        /* body wasn't JSON — fall back to balance:0 */
      }
      throw new PaywallRequiredError(parsed.creditsRemaining ?? 0);
    }
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
  const shareMomentFiredInEpisode = useSessionStore(
    (s) => s.shareMomentFiredInEpisode,
  );
  const creditsRemaining = useSessionStore((s) => s.creditsRemaining);
  const paywallOpen = useSessionStore((s) => s.paywallOpen);
  const startupName = intro.startupName;

  const {
    setPlaythroughId,
    welcomeStarted,
    captureIntro,
    factsExtracted,
    paywallSatisfied,
    episodePlanReady,
    appendBeat,
    sceneImageReady,
    enterGeneratingEpisode,
    exitGeneratingEpisode,
    endRun,
    setEpilogue,
    advanceLine,
    chooseOption,
    advanceScene,
    reset,
    markShareMomentFired,
    setCreditsRemaining,
    creditsExhausted,
    setSessionEmail,
  } = useSessionStore(
    useShallow((s) => ({
      setPlaythroughId: s.setPlaythroughId,
      welcomeStarted: s.welcomeStarted,
      captureIntro: s.captureIntro,
      factsExtracted: s.factsExtracted,
      paywallSatisfied: s.paywallSatisfied,
      episodePlanReady: s.episodePlanReady,
      appendBeat: s.appendBeat,
      sceneImageReady: s.sceneImageReady,
      enterGeneratingEpisode: s.enterGeneratingEpisode,
      exitGeneratingEpisode: s.exitGeneratingEpisode,
      endRun: s.endRun,
      setEpilogue: s.setEpilogue,
      advanceLine: s.advanceLine,
      chooseOption: s.chooseOption,
      advanceScene: s.advanceScene,
      reset: s.reset,
      markShareMomentFired: s.markShareMomentFired,
      setCreditsRemaining: s.setCreditsRemaining,
      creditsExhausted: s.creditsExhausted,
      setSessionEmail: s.setSessionEmail,
    })),
  );
  const setRunFate = useSessionStore((s) => s.setRunFate);
  const appendDialogueLine = useSessionStore((s) => s.appendDialogueLine);
  const resetInFlightBeat = useSessionStore((s) => s.resetInFlightBeat);
  // Read sessionEmail directly off the store so any code path that flips
  // it (LoginModal success, /history logout) re-renders this component
  // and re-runs the balance refetch effect without depending on Next.js's
  // router cache to remount the page.
  const sessionEmail = useSessionStore((s) => s.sessionEmail);

  const router = useRouter();
  const [welcomeLineIndex, setWelcomeLineIndex] = useState(0);
  const [welcomeDone, setWelcomeDone] = useState(false);
  const welcomeCompleteRef = useRef(false);
  const [loginOpen, setLoginOpen] = useState(false);

  // Best-effort session probe — runs once on mount, again after a successful
  // login, again when arriving at the ending screen (paywall verify auto-
  // issues a session cookie, so we want to surface the "Past flights" CTA
  // without needing a page reload). Writes to zustand sessionEmail so any
  // component reading it re-renders.
  const fetchSessionEmail = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { email?: string | null };
      setSessionEmail(data.email ?? null);
    } catch {
      /* network blip — leave previous value */
    }
  }, [setSessionEmail]);

  useEffect(() => {
    // setState happens inside the async fetch resolution, not during the
    // effect body — the cascading-render concern doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSessionEmail();
  }, [fetchSessionEmail]);

  // Pull the server-authoritative balance on hydrate AND whenever the
  // session email changes (welcome-screen login/logout, paywall OTP, fresh
  // Stripe verify). Without the sessionEmail dep, a returning user who
  // signs in via LoginModal would still see the anon balance frozen at
  // mount and the widget would mis-report. Failures are silent — the
  // persisted value stays.
  useEffect(() => {
    if (!hasHydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/credits/balance", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { credits?: number };
        if (cancelled) return;
        if (typeof data.credits === "number") {
          setCreditsRemaining(data.credits);
        }
      } catch {
        /* network blip — keep the persisted value */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasHydrated, sessionEmail, setCreditsRemaining]);

  // The earlier auto-close effect ("if paywallOpen && credits>0, close")
  // turned out to be more harm than help: it made the dev SHOW PAYWALL
  // toggle un-testable for any user who already had credits, and the rare
  // race it was guarding (402 fires, then a parallel-tab payment lands
  // before the modal renders) is acceptable to fall back on — the user
  // just sees a paywall they don't need and either dismisses or buys an
  // extra pack. Closing the modal is now driven solely by
  // paywallSatisfied (Stripe verify or OTP) and explicit dev toggles.

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

  // Share-moment trigger: an LLM scene may carry a `shareMoment` payload, but
  // only one fires per episode. Once any scene in the episode has fired, the
  // budget is spent — even if the player revisits the same scene later. New
  // episodes reset the flag in arcSkeletonReady.
  const shareMomentVisible =
    phase === "scene" &&
    !!currentScene?.shareMoment &&
    shareMomentFiredInEpisode === null;

  useEffect(() => {
    // Synchronise the persisted "fired this episode" flag with the first
    // render that actually shows the overlay. The deps narrow this to one
    // run per scene transition, so the cascading-render concern doesn't
    // apply — this is a one-shot ack, not a state-driven loop.
    if (shareMomentVisible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      markShareMomentFired(sceneIndex);
    }
  }, [shareMomentVisible, sceneIndex, markShareMomentFired]);

  const handleShareMomentShare = useCallback(() => {
    const sm = currentScene?.shareMoment;
    if (!sm) return;
    const playUrl = window.location.origin;
    const text = `${sm.title}\n${sm.blurb}`;
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(playUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [currentScene?.shareMoment]);

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

  // Helpers for episode-call construction.
  // The episode planner's load-bearing input is `lastChoice` — the
  // single most-recent decision the player made. The new episode is a
  // direct consequence of it.
  const buildEpisodeRequestBody = useCallback(
    (episodeIndex: number) => {
      const recentChoices = history.slice(-8).map((h) => ({
        sceneId: h.sceneId,
        choiceLabel: h.choiceLabel,
        hypeDelta: h.hypeDelta,
        integrityDelta: h.integrityDelta,
      }));
      const lastChoice =
        recentChoices.length > 0
          ? recentChoices[recentChoices.length - 1]
          : undefined;

      // Carry forward the just-completed episode's cast so the new
      // episode's planner can return characters by name with voice +
      // appearance preserved (assignVoicesToEpisode reuses the prior
      // voice IDs for matching names server-side).
      const priorCast =
        episodeIndex > 0 ? arc?.currentEpisode?.cast ?? [] : [];

      return {
        episodeIndex,
        priorStorySoFar: arc?.storySoFar,
        lastChoice,
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
        rolledCameos: arc?.rolledCameos,
        tone: arc?.tone,
        firedSeedIds: arc?.firedSeedIds ?? [],
        playthroughId,
        priorCast,
      };
    },
    [arc, intro, history, hype, integrity, playthroughId],
  );

  // Per-run refs — reset on new playthrough.
  const episodeGenFiredRef = useRef<Set<number>>(new Set()); // episodes already requested
  const sceneGenFiredRef = useRef<Set<number>>(new Set()); // legacy, unused after multi-beat rewrite
  const beatFireKeysRef = useRef<Set<string>>(new Set()); // "globalLLM-beatIdx" keys for dedup
  const imageGenFiredRef = useRef<Set<number>>(new Set()); // llm indices whose image gen was requested
  const arcPersistedRef = useRef<number>(-1); // last episodeIndex whose plan was PATCHed
  const extractFiredForRef = useRef<string | null>(null); // last startupDescription extracted for
  // Pre-genned next episode plan, held until the player completes the
  // current episode. Promise resolves to the plan or null on error
  // (errors fall through to a fresh fetch when the player crosses).
  const pendingEpisodeRef = useRef<{
    episodeIndex: number;
    promise: Promise<FetchEpisodeResult | null>;
  } | null>(null);
  // Pre-fired image URLs for the next episode's scenes. Keyed by
  // `${episodeIndex}-${localSceneIndex}`. Populated by the pre-gen
  // .then() handler firing /api/generate-image directly while the
  // player is still in the prior episode's last scene; consumed by
  // the image-gen effect when episodePlanReady eventually swaps
  // arc.currentEpisode (post-cross). Decoupled from the currentEpisode
  // swap so we get parallel pre-warming WITHOUT breaking fireBeat.
  const preFiredImagesRef = useRef<Map<string, string>>(new Map());
  const preFiredKeysRef = useRef<Set<string>>(new Set());
  // Flips true once extraction has settled (success or failure). Arc-gen is
  // gated on this so Sonnet never receives a half-populated player facts block
  // — the cause of the "Maya in The Uninvited Cofounder" bleed.
  const [extractionResolved, setExtractionResolved] = useState(false);
  useEffect(() => {
    episodeGenFiredRef.current = new Set();
    sceneGenFiredRef.current = new Set();
    beatFireKeysRef.current = new Set();
    imageGenFiredRef.current = new Set();
    arcPersistedRef.current = -1;
    extractFiredForRef.current = null;
    pendingEpisodeRef.current = null;
    preFiredImagesRef.current = new Map();
    preFiredKeysRef.current = new Set();
    // If the intro arrived with missingQuestions already populated (dev skip,
    // or a hydrated session), treat extraction as resolved — otherwise gen
    // would stall waiting for an extract-facts call that won't be re-issued.
    const presetMissing =
      useSessionStore.getState().intro.missingQuestions !== undefined;
    setExtractionResolved(presetMissing);
  }, [playthroughId]);

  // Smart Q&A extraction: once the player submits the scene-2 pitch, fire one
  // Haiku call that extracts the canonical facts AND generates Jordan-voice
  // follow-ups for whatever's missing. Result drives scene 4. Always flip
  // extractionResolved so arc-gen is unblocked even on failure.
  useEffect(() => {
    const desc = intro.startupDescription?.trim();
    if (!desc) return;
    if (extractFiredForRef.current === desc) return;
    // If missingQuestions is already explicitly set (dev skip, or a prior
    // extraction in this run), don't re-fire — the LLM call only sees the
    // short pitch and would clobber a known-good answer with one based on
    // less context.
    if (intro.missingQuestions !== undefined) {
      extractFiredForRef.current = desc;
      setExtractionResolved(true);
      return;
    }
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
  }, [
    intro.startupDescription,
    intro.selfDescription,
    intro.missingQuestions,
    factsExtracted,
  ]);

  // Roll per-run "fate" — cameos + tone — once after intro extraction
  // settles. Both are seeded by playthroughId, so the same player gets the
  // same cameos on rehydrate, and two players almost never roll the same
  // set. Idempotent: setRunFate is a no-op once arc.rolledCameos exists.
  // Mirrors the arc-gen gate so the dev-skip path (no pitch) also rolls.
  useEffect(() => {
    if (arc?.rolledCameos && arc?.tone) return;
    if (!playthroughId) return;
    const noPitchSubmitted = !intro.startupDescription?.trim();
    if (!extractionResolved && !noPitchSubmitted) return;
    const seed = playthroughId;
    const flavorTags = intro.flavorTags ?? [];
    const founderPersona = intro.selfDescription ?? "";
    const rolledCameos = rollCameos({ seed, flavorTags, founderPersona });
    const tone = rollTone({ seed, flavorTags, founderPersona });
    setRunFate({ rolledCameos, tone: tone.id });
  }, [
    extractionResolved,
    arc?.rolledCameos,
    arc?.tone,
    playthroughId,
    intro.flavorTags,
    intro.selfDescription,
    intro.startupDescription,
    setRunFate,
  ]);

  // Episode 0 generation: fire as soon as the player has cleared the QA
  // scene (sceneIndex 3). At that point every player-facts field the
  // planner needs is captured, so episode-gen can run while the player
  // walks through scenes 4–7.
  // Gated on extraction having resolved — otherwise the planner receives
  // an undefined team and the prompt fights with default text.
  useEffect(() => {
    // Allow both "scene" (legacy: episode-gen kicked off mid-walk) and
    // "generating-episode" (post-AUTHORED_SCENE_COUNT=4: phase flips
    // immediately after Q&A and the lobby is the only thing in front of
    // episode 0). Without the second branch, the lobby renders forever
    // because nothing ever calls fetchEpisode(0).
    if (phase !== "scene" && phase !== "generating-episode") return;
    if (sceneIndex < POST_QA_SCENE_INDEX) return;
    if (arc?.currentEpisode?.episodeIndex === 0) return;
    if (episodeGenFiredRef.current.has(0)) return;
    const noPitchSubmitted = !intro.startupDescription?.trim();
    if (!extractionResolved && !noPitchSubmitted) return;
    if (!arc?.rolledCameos || !arc?.tone) return;
    episodeGenFiredRef.current.add(0);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EPISODE_GEN_TIMEOUT_MS,
    );
    fetchEpisode(buildEpisodeRequestBody(0), { signal: controller.signal })
      .then((data) => {
        episodePlanReady(data.episode);
        if (typeof data.creditsRemaining === "number") {
          setCreditsRemaining(data.creditsRemaining);
        }
      })
      .catch((err) => {
        if (err instanceof PaywallRequiredError) {
          episodeGenFiredRef.current.delete(0);
          setCreditsRemaining(err.balance);
          creditsExhausted();
          return;
        }
        console.error("generate-episode[0] failed", err);
        // Allow a retry on the next render — the loader stays up.
        episodeGenFiredRef.current.delete(0);
      })
      .finally(() => clearTimeout(timeoutId));
  }, [
    phase,
    sceneIndex,
    arc?.currentEpisode,
    arc?.rolledCameos,
    arc?.tone,
    extractionResolved,
    intro.startupDescription,
    buildEpisodeRequestBody,
    episodePlanReady,
    setCreditsRemaining,
    creditsExhausted,
  ]);

  // Per-beat generation. A scene is a CONTAINER with a pre-fixed
  // setting/cast/imagePrompt; many beats (dialogue+choice cycles)
  // play inside that container. Each beat is generated on the fly
  // when the player makes a choice. The scene closes when the LLM
  // emits isLastBeatOfScene.
  //
  // This effect is the dispatcher:
  //  - on episode plan landing → fire beat 0 of scene 0
  //  - on choice click (handleChoice → fireNextBeat below) → fires
  //    next beat of current scene OR moves to next scene's beat 0
  // Tracking: sceneGenFiredRef holds keys "globalLLM-beatIndex" for
  // dedup across renders.
  const beatGenFiredRef = beatFireKeysRef;
  const fireBeat = useCallback(
    (sceneIndexInEpisode: number, beatIdx: number, priorBeatChoice?: { sceneId: number; choiceLabel: string; hypeDelta: number; integrityDelta: number }) => {
      const ep = arc?.currentEpisode;
      if (!ep) return;
      const startLLM = ep.startLLMIndex ?? 0;
      const globalLLMIndex = startLLM + sceneIndexInEpisode;
      const key = `${globalLLMIndex}-${beatIdx}`;
      if (beatGenFiredRef.current.has(key)) return;
      const stored = arc?.scenes[globalLLMIndex];
      const beatStarts = stored?.beatStarts ?? [0];
      // If this beat already has dialogue past its start index, skip
      // (rehydrate / re-render).
      if (
        stored &&
        beatIdx < beatStarts.length &&
        stored.dialogue.length > (beatStarts[beatIdx] ?? 0) &&
        stored.choices.length > 0
      ) {
        return;
      }
      beatGenFiredRef.current.add(key);

      // For beat 0 of scene 0: priorBeatChoice undefined.
      // For beat 0 of scene N>0: priorBeatChoice = the player's last
      //   choice from scene N-1's last beat (lives in history; the
      //   route also reads `recentChoices` for cross-scene tone).
      // For beat N>0 of any scene: priorBeatChoice = the choice from
      //   beat N-1 of THIS scene.
      // The route uses priorBeatChoice as the load-bearing input.
      const priorBeatsDialogue =
        beatIdx > 0 && stored
          ? stored.dialogue.slice(0, beatStarts[beatIdx] ?? stored.dialogue.length)
          : [];

      streamScene(
        {
          episode: ep,
          episodeIndex: ep.episodeIndex,
          sceneIndexInEpisode,
          beatIndex: beatIdx,
          priorBeatsDialogue,
          priorBeatChoice,
          storySoFar: arc?.storySoFar,
          startupName: arc?.startupName,
          startupDescription: intro.startupDescription ?? "",
          founderPersona: arc?.founderPersona,
          team: intro.team,
          fundingModel: intro.fundingModel,
          targetCustomer: intro.targetCustomer,
          concern: intro.concern,
          recentChoices: history.slice(-8).map((h) => ({
            sceneId: h.sceneId,
            choiceLabel: h.choiceLabel,
            hypeDelta: h.hypeDelta,
            integrityDelta: h.integrityDelta,
          })),
          currentStats: { hype, integrity },
          playthroughId,
          tone: arc?.tone,
        },
        {
          onDialogueLine: (line) => appendDialogueLine(globalLLMIndex, line),
        },
      )
        .then((data) => {
          appendBeat(globalLLMIndex, data.beat);
          // Skip auto-exit during the first-episode Narrator lobby — the
          // Continue button drives the exit so the player can ask the
          // narrator questions while gen completes. Mid-run transitions
          // still auto-exit as before.
          const inLobby =
            useSessionStore.getState().progress.sceneIndex ===
            AUTHORED_SCENE_COUNT;
          if (!inLobby) {
            exitGeneratingEpisode();
          }
        })
        .catch((err) => {
          beatGenFiredRef.current.delete(key);
          if (err instanceof PaywallRequiredError) {
            setCreditsRemaining(err.balance);
            creditsExhausted();
            return;
          }
          console.error(`generate-scene[${key}] failed`, err);
        });
    },
    [
      arc,
      intro.startupDescription,
      intro.team,
      intro.fundingModel,
      intro.targetCustomer,
      intro.concern,
      history,
      hype,
      integrity,
      appendBeat,
      appendDialogueLine,
      exitGeneratingEpisode,
      playthroughId,
      setCreditsRemaining,
      creditsExhausted,
      beatGenFiredRef,
    ],
  );

  // Fire beat 0 of scene 0 the moment the episode plan lands. Subsequent
  // beats fire from handleChoice (player clicks → next beat).
  // For beat 0 of scenes after scene 0, the prior scene's LAST choice
  // is passed as priorBeatChoice so scene-gen can decide whether to
  // render the planned scene as-is OR pivot to follow what the player
  // just did.
  useEffect(() => {
    if (phase !== "scene" && phase !== "generating-episode") return;
    const ep = arc?.currentEpisode;
    if (!ep || !Array.isArray(ep.scenes) || ep.scenes.length === 0) return;
    const startLLM = ep.startLLMIndex ?? 0;

    const lastHistory = history[history.length - 1];
    const carryOverChoice = lastHistory
      ? {
          sceneId: lastHistory.sceneId,
          choiceLabel: lastHistory.choiceLabel,
          hypeDelta: lastHistory.hypeDelta,
          integrityDelta: lastHistory.integrityDelta,
        }
      : undefined;

    const sceneZero = arc?.scenes[startLLM];
    if (sceneZero && sceneZero.dialogue.length === 0) {
      // Scene 0 of the episode: carryOverChoice is the prior episode's
      // last choice (or an authored-intro choice for episode 0). Useful
      // context for the opening beat to acknowledge the carry-over.
      fireBeat(0, 0, carryOverChoice);
    }
    if (phase === "scene" && sceneIndex >= AUTHORED_SCENE_COUNT) {
      const localIndex = sceneIndex - AUTHORED_SCENE_COUNT - startLLM;
      if (localIndex >= 0 && localIndex < ep.scenes.length) {
        const slot = arc?.scenes[startLLM + localIndex];
        if (slot && slot.dialogue.length === 0) {
          // Beat 0 of any scene the player has just walked into. Pass
          // the prior scene's last choice (= last entry in history) so
          // scene-gen can pivot the planned scene if needed.
          fireBeat(localIndex, 0, carryOverChoice);
        } else if (slot && choiceMade !== null) {
          // Offline-recovery: the player picked a choice but the next
          // beat's streamScene never landed (network dropped). On
          // refresh, sessionStorage rehydrates with choiceMade set and
          // beatStarts already extended (it ran sync pre-network), but
          // dialogue.length still sits at the in-flight beat's start.
          // Without this branch, ChoicePanel stays disabled forever.
          const beatStarts = slot.beatStarts ?? [0];
          const lastBeatStart = beatStarts[beatStarts.length - 1] ?? 0;
          if (
            beatStarts.length > 1 &&
            slot.dialogue.length === lastBeatStart
          ) {
            fireBeat(localIndex, beatStarts.length - 1, carryOverChoice);
          }
        }
      }
    }
  }, [phase, sceneIndex, arc, history, choiceMade, fireBeat]);

  // Image-gen: SEQUENTIAL. Image 1 generates first, lands on
  // arc.scenes[startLLM]; then image 2 starts, lands on
  // arc.scenes[startLLM+1]; etc. One in-flight call at a time per
  // episode.
  // Why sequential: (1) lower concurrent load on the image API,
  // (2) the player walks scenes in order so image N+1 doesn't need
  // to be ready before scene N is consumed (~30-60s of dialogue
  // per scene comfortably covers ~30s/image gen).
  // The "imageQueueTick" counter bumps on every fetch-completion so
  // the effect re-runs and picks the next un-fired slot regardless
  // of whether sceneImageReady fired (success) or didn't (error).
  const imageQueueRef = useRef<{ inFlight: boolean }>({ inFlight: false });
  const [imageQueueTick, setImageQueueTick] = useState(0);
  useEffect(() => {
    if (!arc?.currentEpisode) return;
    const ep = arc.currentEpisode;
    if (!Array.isArray(ep.scenes)) return;
    const startLLM = ep.startLLMIndex ?? 0;

    // First pass: apply any URLs that pre-gen pre-fired while the
    // player was still in the prior episode. preFiredImagesRef is
    // keyed by `${episodeIndex}-${localSceneIndex}`. preFiredKeysRef
    // marks slots whose pre-fire is in flight (we mark imageGenFiredRef
    // for those so we don't double-fire; pre-fire .then() will bump
    // imageQueueTick when the URL arrives, re-running this effect).
    for (let i = 0; i < ep.scenes.length; i++) {
      const slot = startLLM + i;
      if (imageGenFiredRef.current.has(slot)) continue;
      if (arc?.scenes[slot]?.imageUrl) {
        imageGenFiredRef.current.add(slot);
        continue;
      }
      const key = `${ep.episodeIndex}-${i}`;
      const cachedUrl = preFiredImagesRef.current.get(key);
      if (cachedUrl) {
        sceneImageReady(slot, cachedUrl);
        imageGenFiredRef.current.add(slot);
        continue;
      }
      if (preFiredKeysRef.current.has(key)) {
        // Pre-fire is in flight for this slot; mark fired so the
        // fresh-fetch path skips it. URL will land via the cachedUrl
        // branch on a later tick when pre-fire resolves.
        imageGenFiredRef.current.add(slot);
      }
    }

    if (imageQueueRef.current.inFlight) return;

    // Second pass: find the first slot that's still unfired (pre-fire
    // didn't claim it AND the URL isn't already in arc) and fire fresh.
    let nextIndex = -1;
    for (let i = 0; i < ep.scenes.length; i++) {
      const slot = startLLM + i;
      if (imageGenFiredRef.current.has(slot)) continue;
      nextIndex = i;
      break;
    }
    if (nextIndex < 0) return;

    const slot = startLLM + nextIndex;
    const plan = ep.scenes[nextIndex];
    imageGenFiredRef.current.add(slot);
    imageQueueRef.current.inFlight = true;

    // Pick the primary character of the scene — first cast member whose
    // role matches plan.role, falling back to the first cast member.
    // Both the name (so gpt-image-2 can render real-figure likenesses)
    // and appearance (clothing/build/features) get forwarded.
    const primaryCast =
      plan.cast?.find((c) => c.role === plan.role) ?? plan.cast?.[0];
    const appearance = primaryCast?.appearance;
    const name = primaryCast?.name;

    fetch("/api/generate-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scene",
        scenePrompt: plan.imagePrompt,
        archetype: plan.role,
        quality: "low",
        appearance,
        name,
      }),
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((data: { url?: string }) => {
        if (data.url) sceneImageReady(slot, data.url);
      })
      .catch((err) => {
        imageGenFiredRef.current.delete(slot);
        console.error(`[image-gen] failed slot=${slot}`, err);
      })
      .finally(() => {
        imageQueueRef.current.inFlight = false;
        // Bump the tick so this effect re-runs and picks the next
        // un-fired slot regardless of whether arc.scenes changed.
        setImageQueueTick((n) => n + 1);
      });
  }, [arc?.currentEpisode, arc?.scenes, sceneImageReady, imageQueueTick]);

  // Cinematic exit: as soon as the first scene of a freshly-planned
  // episode has dialogue, drop out of the loader.
  // Exception: the authored→first-episode handoff renders NarratorLobby,
  // which gates exit on the player's Continue button. Skip auto-exit
  // when sceneIndex === AUTHORED_SCENE_COUNT (= the lobby slot).
  useEffect(() => {
    if (phase !== "generating-episode") return;
    if (sceneIndex === AUTHORED_SCENE_COUNT) return;
    const ep = arc?.currentEpisode;
    if (!ep) return;
    const startLLM = ep.startLLMIndex ?? 0;
    const stored = arc?.scenes[startLLM];
    if (stored && stored.dialogue.length > 0) {
      exitGeneratingEpisode();
    }
  }, [phase, sceneIndex, arc, exitGeneratingEpisode]);

  // Episode persistence: PATCH the playthrough each time a new episode
  // plan lands. Strips imageUrls (runtime-only).
  useEffect(() => {
    if (!playthroughId) return;
    if (!arc?.currentEpisode) return;
    if (arcPersistedRef.current === arc.currentEpisode.episodeIndex) return;
    arcPersistedRef.current = arc.currentEpisode.episodeIndex;

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

  // End-of-episode trigger: when the player has advanced PAST a scene
  // marked `isLastSceneOfEpisode: true`, kick off the next episode's
  // planner. The LLM (Haiku, scene-gen) decides when the arc closes
  // by setting this flag on whichever scene closes the episode's
  // arc — typically after 3–6 scenes.
  // Safety: also force-end after MAX_SCENES_PER_EPISODE so the LLM
  // can't run an episode forever.

  // Pre-gen: kick off the next episode's planner the moment the
  // player enters the LAST planned scene of the current episode. The
  // result is held in pendingEpisodeRef and only activated when the
  // end-trigger below fires (player crosses past the closer).
  //
  // We CANNOT call episodePlanReady eagerly from .then() — that swaps
  // arc.currentEpisode mid-play, and fireBeat (which uses
  // currentEpisode to compute sceneIndexInEpisode) would then send
  // mismatched scene indices to /api/generate-scene, which 400s on
  // "no scene plan at index N". Eager activation was tried in PR57
  // and reverted.
  useEffect(() => {
    if (phase !== "scene") return;
    const ep = arc?.currentEpisode;
    if (!ep || !Array.isArray(ep.scenes) || ep.scenes.length === 0) return;
    const startLLM = ep.startLLMIndex ?? 0;
    const localIndex = sceneIndex - AUTHORED_SCENE_COUNT - startLLM;
    if (localIndex !== ep.scenes.length - 1) return;

    const nextEpisode = ep.episodeIndex + 1;
    if (episodeGenFiredRef.current.has(nextEpisode)) return;
    episodeGenFiredRef.current.add(nextEpisode);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EPISODE_GEN_TIMEOUT_MS,
    );
    const promise = fetchEpisode(buildEpisodeRequestBody(nextEpisode), {
      signal: controller.signal,
    })
      .then((data): FetchEpisodeResult | null => {
        // Pre-fire image-gen for every scene of the new episode in
        // parallel, while the player walks the prior episode's last
        // scene. URLs land in preFiredImagesRef; the image-gen effect
        // applies them as soon as episodePlanReady runs (post-cross).
        // We do NOT swap arc.currentEpisode here (see PR57/PR58 — that
        // breaks fireBeat). The currentEpisode swap still happens
        // through the end-trigger when the player crosses.
        const ep = data.episode;
        for (let i = 0; i < ep.scenes.length; i++) {
          const key = `${ep.episodeIndex}-${i}`;
          if (preFiredKeysRef.current.has(key)) continue;
          preFiredKeysRef.current.add(key);

          const plan = ep.scenes[i];
          const primaryCast =
            plan.cast?.find((c) => c.role === plan.role) ?? plan.cast?.[0];
          fetch("/api/generate-image", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "scene",
              scenePrompt: plan.imagePrompt,
              archetype: plan.role,
              quality: "low",
              appearance: primaryCast?.appearance,
              name: primaryCast?.name,
            }),
          })
            .then((r) =>
              r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
            )
            .then((d: { url?: string }) => {
              if (d.url) {
                preFiredImagesRef.current.set(key, d.url);
                // Wake the image-gen effect so it can pick the URL up
                // (via its cache-check loop) once arc.currentEpisode
                // is the matching episode.
                setImageQueueTick((n) => n + 1);
              }
            })
            .catch((err) => {
              preFiredKeysRef.current.delete(key);
              console.warn(
                `pre-fire image-gen[${key}] failed (will refire on cross)`,
                err,
              );
            });
        }
        return data;
      })
      .catch((err): FetchEpisodeResult | null => {
        // Silent during pre-gen — the end-trigger will retry fresh
        // when the player crosses, surfacing paywall etc at the
        // right narrative moment.
        console.warn(
          `pre-gen[${nextEpisode}] failed (will retry on cross)`,
          err,
        );
        episodeGenFiredRef.current.delete(nextEpisode);
        if (
          pendingEpisodeRef.current &&
          pendingEpisodeRef.current.episodeIndex === nextEpisode
        ) {
          pendingEpisodeRef.current = null;
        }
        return null;
      })
      .finally(() => clearTimeout(timeoutId));

    pendingEpisodeRef.current = { episodeIndex: nextEpisode, promise };
  }, [phase, sceneIndex, arc?.currentEpisode, buildEpisodeRequestBody]);

  useEffect(() => {
    if (phase !== "scene") return;
    const ep = arc?.currentEpisode;
    if (!ep || !Array.isArray(ep.scenes)) return;
    const startLLM = ep.startLLMIndex ?? 0;
    const playerLocalIndex = sceneIndex - AUTHORED_SCENE_COUNT - startLLM;
    if (playerLocalIndex < 0) return;

    const MAX_SCENES_PER_EPISODE = 8;
    // Find the lowest scene-in-episode index where:
    //   (a) the scene exists in arc.scenes with dialogue (LLM finished it)
    //   (b) the LLM marked it as the episode's closer, OR
    //       the player has already played MAX_SCENES_PER_EPISODE scenes
    //       in this episode (safety force-end)
    // and the player has advanced PAST it.
    let endSceneLocal = -1;
    for (let i = 0; i < arc.scenes.length - startLLM; i++) {
      const s = arc?.scenes[startLLM + i];
      if (!s || s.dialogue.length === 0) break;
      if (s.isLastSceneOfEpisode || i + 1 >= MAX_SCENES_PER_EPISODE) {
        endSceneLocal = i;
        break;
      }
    }
    if (endSceneLocal < 0) return;
    if (playerLocalIndex <= endSceneLocal) return;

    const nextEpisode = ep.episodeIndex + 1;

    // Fast path: pre-gen already kicked off when the player entered
    // the last planned scene. Wait on its promise — if it resolved
    // successfully, activate now. If it resolved to null (pre-gen
    // failure), fall through to a fresh fetch on the next render.
    //
    // CRITICAL: clear pendingEpisodeRef BEFORE attaching the .then.
    // This effect re-runs whenever its deps change (sceneIndex, arc,
    // etc), and arc churns while scene-gen streams dialogue lines.
    // Without clearing first, every re-run attaches another .then to
    // the same promise, which fires episodePlanReady N times once the
    // promise resolves and blows the React update depth.
    const pending = pendingEpisodeRef.current;
    if (pending && pending.episodeIndex === nextEpisode) {
      pendingEpisodeRef.current = null;
      enterGeneratingEpisode();
      pending.promise.then((data) => {
        if (data) {
          episodePlanReady(data.episode);
          if (typeof data.creditsRemaining === "number") {
            setCreditsRemaining(data.creditsRemaining);
          }
          return;
        }
        // Pre-gen failed silently. Allow the fresh-fetch path on
        // next render by re-opening the dedup gate.
        episodeGenFiredRef.current.delete(nextEpisode);
      });
      return;
    }

    if (episodeGenFiredRef.current.has(nextEpisode)) return;
    episodeGenFiredRef.current.add(nextEpisode);

    enterGeneratingEpisode();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EPISODE_GEN_TIMEOUT_MS,
    );
    fetchEpisode(buildEpisodeRequestBody(nextEpisode), {
      signal: controller.signal,
    })
      .then((data) => {
        episodePlanReady(data.episode);
        if (typeof data.creditsRemaining === "number") {
          setCreditsRemaining(data.creditsRemaining);
        }
      })
      .catch((err) => {
        episodeGenFiredRef.current.delete(nextEpisode);
        if (err instanceof PaywallRequiredError) {
          setCreditsRemaining(err.balance);
          creditsExhausted();
          return;
        }
        console.error(`generate-episode[${nextEpisode}] failed`, err);
      })
      .finally(() => clearTimeout(timeoutId));
  }, [
    phase,
    sceneIndex,
    arc?.currentEpisode,
    buildEpisodeRequestBody,
    enterGeneratingEpisode,
    episodePlanReady,
    setCreditsRemaining,
    creditsExhausted,
  ]);

  // Safety: if the player jumps directly to generating-episode via dev
  // panel and there's no plan yet, just enter the loader phase (the
  // episode-0 effect above handles the actual fetch).
  useEffect(() => {
    if (phase !== "generating-episode") return;
    if (!arc?.currentEpisode) {
      enterGeneratingEpisode();
    }
  }, [phase, arc?.currentEpisode, enterGeneratingEpisode]);

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

      // Episode-architecture: LLM scenes are CONTAINERS that hold many
      // beats. When the player clicks a choice on an LLM scene:
      //   - If sceneClosed (LLM marked isLastBeatOfScene=true): advance
      //     to the next scene container.
      //   - Else: stay in this scene; fire the next beat. The new
      //     beat's dialogue appends and choices replace.
      // Authored scenes (sceneIndex < AUTHORED_SCENE_COUNT) keep the
      // legacy advanceScene flow.
      if (sceneIndex < AUTHORED_SCENE_COUNT) {
        setTimeout(() => advanceScene(), 600);
        return;
      }

      const ep = arc?.currentEpisode;
      if (!ep || !Array.isArray(ep.scenes)) {
        setTimeout(() => advanceScene(), 600);
        return;
      }
      const startLLM = ep.startLLMIndex ?? 0;
      const sceneIdxInEp = sceneIndex - AUTHORED_SCENE_COUNT - startLLM;
      const llmScene = arc?.scenes[sceneIndex - AUTHORED_SCENE_COUNT];
      const sceneClosed = !!llmScene?.sceneClosed;

      if (sceneClosed) {
        setTimeout(() => advanceScene(), 600);
        return;
      }

      // Fire next beat in this scene. Mark the in-flight boundary so
      // streaming dialogueLine events append from the right offset;
      // appendBeat will rebase trailing partial lines on `done`.
      const globalLLMIndex = sceneIndex - AUTHORED_SCENE_COUNT;
      resetInFlightBeat(globalLLMIndex);
      // Reset the scene's dialogue cursor for the player to read the
      // new beat's lines fresh. We do this via the existing
      // chooseOption-clears-progress path, but progress was set to
      // showChoices=true; we want showChoices=false for the new beat.
      // The session store's chooseOption already records the choice.
      // We need a small extra: reset progress to read new dialogue.
      // Use advanceLine indirectly via a workaround: rely on the
      // currentLineIndex moving forward to the new dialogue's start
      // when next beat lands. The dialogue rendering effect picks it
      // up.
      const beatIdx = (llmScene?.beatStarts?.length ?? 1); // beatStarts already extended by resetInFlightBeat
      const priorBeatChoice = {
        sceneId: currentScene.id,
        choiceLabel,
        hypeDelta,
        integrityDelta,
      };
      // Allow the choice's UI feedback to land before we kick the
      // next beat. The 600ms also covers the typical chooseOption
      // animation.
      setTimeout(() => {
        fireBeat(sceneIdxInEp, beatIdx, priorBeatChoice);
      }, 250);
    },
    [
      currentScene,
      chooseOption,
      advanceScene,
      playthroughId,
      sceneIndex,
      arc,
      resetInFlightBeat,
      fireBeat,
    ],
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

  const lobbyActive =
    phase === "generating-episode" && sceneIndex === AUTHORED_SCENE_COUNT;
  const lobbyStartLLM = arc?.currentEpisode?.startLLMIndex ?? 0;
  const lobbyFirstScene = arc?.scenes?.[lobbyStartLLM];
  const lobbyReady =
    !!arc?.currentEpisode &&
    !!lobbyFirstScene &&
    (lobbyFirstScene.dialogue?.length ?? 0) > 0 &&
    !!lobbyFirstScene.imageUrl;

  const dialogueSlot = (() => {
    if (lobbyActive) {
      return (
        <NarratorLobby
          ready={lobbyReady}
          context={{
            startupName: arc?.startupName ?? intro.startupName,
            startupDescription: intro.startupDescription,
            selfDescription: intro.selfDescription,
            team: intro.team,
            fundingModel: intro.fundingModel,
            concern: intro.concern,
          }}
          onContinue={exitGeneratingEpisode}
        />
      );
    }

    if (phase === "welcome" && !welcomeDone) {
      return (
        <div className="w-full max-w-2xl mx-auto px-2 select-none">
          <DialogueSpeaker speaker={undefined} />
          <DialogueSubtitle
            key={`welcome-line${welcomeLineIndex}`}
            text={WELCOME_LINES[welcomeLineIndex]}
            wordInterval={100}
            onComplete={handleWelcomeLineComplete}
            voiceId={NARRATOR_VOICE_ID}
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
              voiceId={voiceIdForSpeaker(qaPromptLine.speaker)}
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
                voiceId={currentLine.voiceId ?? voiceIdForSpeaker(currentLine.speaker)}
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
            Show me →
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

      case "generating-episode":
        // First-episode transition: NarratorLobby renders in dialogueSlot
        // and owns its own UI. Skip the centered loading card.
        if (lobbyActive) return null;
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
            <EndingFateCard
              rolledCameos={arc?.rolledCameos}
              tone={arc?.tone}
            />
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
      {paywallOpen && (
        <PaywallPanel
          onSatisfied={(creditsGranted) => paywallSatisfied(creditsGranted)}
        />
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
        EXCEPT on welcome (already linked there), while the paywall overlay is
        open (don't interrupt payment), and on ending (its own CTA covers
        it). Sits above the GameShell header so it overlays the cinematic
        without nudging layout.
      */}
      {sessionEmail &&
        phase !== "welcome" &&
        !paywallOpen &&
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
              ? (currentScene?.background ?? GROUP1_BACKGROUND)
              : phase === "generating-episode"
                ? GROUP1_BACKGROUND
                : WELCOME_BACKGROUND
        }
        dialogueSlot={dialogueSlot}
        bottomPanel={bottomPanel}
      >
        {centerContent}
      </GameShell>

      {shareMomentVisible && currentScene?.shareMoment && (
        <ShareNotification
          visible
          title={currentScene.shareMoment.title}
          blurb={currentScene.shareMoment.blurb}
          onShare={handleShareMomentShare}
        />
      )}
    </>
  );
}
