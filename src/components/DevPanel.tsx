"use client";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useSessionStore,
  AUTHORED_SCENE_COUNT,
  EPISODE_LENGTH_DEFAULT,
  type Phase,
} from "@/lib/session";
import { SCENES } from "@/lib/scenes";
import { ARCHETYPES } from "@/lib/archetypes";
import type { Scene as LLMScene } from "@/lib/types";

interface DevTarget {
  label: string;
  phase: Phase;
  sceneIndex?: number;
  available?: boolean;
}

const STATIC_TARGETS_HEAD: DevTarget[] = [
  { label: "Welcome", phase: "welcome" },
  { label: "Scene 1", phase: "scene", sceneIndex: 0 },
  { label: "Scene 2", phase: "scene", sceneIndex: 1 },
  { label: "Scene 3", phase: "scene", sceneIndex: 2 },
  { label: "Scene 4 (Q&A)", phase: "scene", sceneIndex: 3 },
  { label: "Generating Episode", phase: "generating-episode" },
];

const STATIC_TARGETS_TAIL: DevTarget[] = [{ label: "Ending", phase: "ending" }];

const SESSION_STORAGE_KEY = "roadtosf-session";

const PHASES_REQUIRING_PLAYTHROUGH: Phase[] = ["scene", "ending"];

// Used by the "skip onboarding" dev shortcut to seed the IntroData fields
// the post-onboarding scenes expect, so the player drops straight into
// scene 3 (Q&A) without the conversational startup-pitching flow.
const HARDCODED_INTRO = {
  startupName: "Wagr",
  startupDescription: "Compliance software for crypto exchanges.",
  selfDescription:
    "Anxious second-time founder, ex-Stripe PM, terrified of the YC rejection email.",
  stage: "Pre-seed, just incorporated",
  team: "Solo (looking for a technical cofounder)",
  fundingModel: "Raising — six months of personal runway",
  targetCustomer: "Compliance leads at mid-size crypto exchanges",
  concern: "Not sure if this should be SaaS or a marketplace",
  flavorTags: ["YC", "Tartine", "Sand Hill"],
  transcript: "[dev skip — hardcoded onboarding]",
  // Pre-set [] so the scene-4 Q&A auto-skips even before extract-facts
  // returns (which would either echo [] or error and leave this untouched).
  missingQuestions: [],
};

function formatRoleSpeaker(speaker: string): string {
  if (speaker === "player") return "You";
  if (speaker === "narrator") return "";
  const def = ARCHETYPES[speaker as keyof typeof ARCHETYPES];
  if (!def) return speaker;
  return `${def.roleLabel} · ${def.title}`;
}

export default function DevPanel() {
  const [open, setOpen] = useState(false);
  const [showTranscripts, setShowTranscripts] = useState(false);
  const phase = useSessionStore((s) => s.phase);
  const sceneIndex = useSessionStore((s) => s.progress.sceneIndex);
  const devSetPhase = useSessionStore((s) => s.devSetPhase);
  const playthroughId = useSessionStore((s) => s.playthroughId);
  const setPlaythroughId = useSessionStore((s) => s.setPlaythroughId);
  const captureIntro = useSessionStore((s) => s.captureIntro);
  const reset = useSessionStore((s) => s.reset);
  const wipeAll = useSessionStore((s) => s.wipeAll);
  const advanceScene = useSessionStore((s) => s.advanceScene);
  const chooseOption = useSessionStore((s) => s.chooseOption);
  const paywallOpen = useSessionStore((s) => s.paywallOpen);
  const devGrantCredits = useSessionStore((s) => s.devGrantCredits);
  const paywallSatisfied = useSessionStore((s) => s.paywallSatisfied);
  const arcSkeleton = useSessionStore((s) => s.arc?.currentEpisode);
  const storySoFar = useSessionStore((s) => s.arc?.storySoFar);
  const dynamicScenes = useSessionStore(
    useShallow((s) => s.arc?.scenes ?? []),
  );

  const [, setTick] = useState(0);

  useEffect(() => {
    const onStorage = () => setTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (process.env.NODE_ENV !== "development") return null;

  // Endless mode: scene targets grow as scenes are generated. Always show one
  // "stub" extra slot so the player can preview what's pending.
  const generatedCount = dynamicScenes.filter(
    (s) => s && s.dialogue.length > 0,
  ).length;
  const targetSlotCount = Math.max(EPISODE_LENGTH_DEFAULT, generatedCount + 1);
  const llmTargets: DevTarget[] = Array.from({ length: targetSlotCount }, (_, i) => {
    const scene = dynamicScenes[i];
    const ready = !!scene && scene.dialogue.length > 0;
    return {
      label: `Scene ${AUTHORED_SCENE_COUNT + i + 1}${ready ? "" : " ·"}`,
      phase: "scene",
      sceneIndex: AUTHORED_SCENE_COUNT + i,
      available: ready,
    };
  });

  const targets: DevTarget[] = [
    ...STATIC_TARGETS_HEAD,
    ...llmTargets,
    ...STATIC_TARGETS_TAIL,
  ];

  const goTo = async (target: DevTarget) => {
    if (target.available === false) return;
    devSetPhase(target.phase, target.sceneIndex);
    setTick((t) => t + 1);

    if (
      PHASES_REQUIRING_PLAYTHROUGH.includes(target.phase) &&
      !playthroughId
    ) {
      try {
        const r = await fetch("/api/playthroughs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            flavorTags: [],
            introTranscript: "[dev jump — no onboarding]",
          }),
        });
        const data = (await r.json()) as { id?: string };
        if (data.id) setPlaythroughId(data.id);
      } catch (err) {
        console.error("dev backfill playthrough failed", err);
      }
    }
  };

  const wipeSession = () => {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    // wipeAll, not reset, because this is the "fully fresh anon" button —
    // it nukes credits + session email too. reset preserves those.
    wipeAll();
    setTick((t) => t + 1);
  };

  const grantSixCredits = async () => {
    // Server-side grant first: writes a real user_balance row keyed by
    // anon_id so /api/generate-scene has something to debit. Without this,
    // the client mirror would say 6 but the very first group fire would
    // 402 and bounce us back to the paywall. We use the absolute balance
    // returned by the server rather than re-adding 6 client-side, so a
    // user who's accumulated dev grants across multiple clicks doesn't see
    // a stale optimistic count.
    let serverBalance: number | null = null;
    try {
      const r = await fetch("/api/dev/grant-credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 6 }),
      });
      if (r.ok) {
        const data = (await r.json()) as { creditsRemaining?: number };
        if (typeof data.creditsRemaining === "number") {
          serverBalance = data.creditsRemaining;
        }
      } else {
        console.error("dev grant-credits returned", r.status);
      }
    } catch (err) {
      console.error("dev grant-credits failed", err);
    }

    // paywallSatisfied closes the overlay and flips paid=true; devGrantCredits
    // does the same flip without touching paywallOpen. Either is safe to call
    // unconditionally — passing 0 because we set the absolute balance from
    // the server response below.
    if (paywallOpen) {
      paywallSatisfied(0);
    } else {
      devGrantCredits(0);
    }
    if (serverBalance !== null) {
      useSessionStore.getState().setCreditsRemaining(serverBalance);
    } else {
      // Server grant failed — fall back to client-only so the dev UX still
      // unblocks; the user will hit a 402 on first group and we'll know to
      // check server logs.
      useSessionStore.getState().setCreditsRemaining(6);
    }
    setTick((t) => t + 1);
  };

  const skipScene = () => {
    // Record a synthetic "skip" choice so the next episode's planner
    // sees something in history (otherwise recentChoices is empty and
    // the prompt's choice-responsiveness rules go quiet). 0/0 deltas
    // = no stat impact. Then bump sceneIndex; the existing flow takes
    // over (mid-episode → fire next scene's beat-gen, last scene →
    // trip end-trigger → episode-gen).
    if (phase === "scene") {
      chooseOption("skip", "[dev skip]", 0, 0, false);
      advanceScene();
      setTick((t) => t + 1);
    }
  };

  const togglePaywall = () => {
    // Toggle the overlay on/off. The paywall has no built-in close button
    // (real users have to pay), so the dev panel is the escape hatch when
    // testing. State underneath is preserved.
    const store = useSessionStore.getState();
    store.setPaywallOpen(!store.paywallOpen);
    setTick((t) => t + 1);
  };

  const skipOnboarding = async () => {
    // Wipe + inject hardcoded intro + jump to scene 3 (post-onboarding,
    // start of the car-ride Q&A). With the paywall removed from the scene
    // flow, this is the new "fast lane" for testing the rest of the run
    // without typing through the conversational onboarding every time.
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    reset();

    captureIntro(HARDCODED_INTRO);

    devSetPhase("scene", 3);
    setTick((t) => t + 1);

    try {
      const r = await fetch("/api/playthroughs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startupName: HARDCODED_INTRO.startupName,
          startupDescription: HARDCODED_INTRO.startupDescription,
          selfDescription: HARDCODED_INTRO.selfDescription,
          flavorTags: HARDCODED_INTRO.flavorTags,
          introTranscript: HARDCODED_INTRO.transcript,
        }),
      });
      const data = (await r.json()) as { id?: string };
      if (data.id) setPlaythroughId(data.id);
    } catch (err) {
      console.error("dev skip-onboarding playthrough failed", err);
    }
  };

  const isActive = (target: DevTarget) =>
    phase === target.phase &&
    (target.sceneIndex === undefined || target.sceneIndex === sceneIndex);

  const currentEpisode = arcSkeleton?.episodeIndex ?? 0;

  return (
    <div className="fixed bottom-4 right-4 z-[100] font-mono">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="bg-black/75 border border-white/20 text-white/70 text-[10px] tracking-widest px-3 py-1.5 rounded hover:bg-black/90 hover:text-white transition-colors"
        >
          DEV
        </button>
      ) : (
        <div
          className={`bg-black/90 border border-white/20 rounded-lg p-3 backdrop-blur shadow-2xl ${
            showTranscripts ? "w-96" : "w-60"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/50 text-[10px] tracking-widest uppercase">
              Dev Nav
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-white/40 hover:text-white text-sm leading-none w-5 h-5 flex items-center justify-center"
              aria-label="Close dev panel"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 mb-2">
            {targets.map((t) => {
              const active = isActive(t);
              const disabled = t.available === false;
              return (
                <button
                  key={t.label + t.phase + (t.sceneIndex ?? "")}
                  onClick={() => goTo(t)}
                  disabled={disabled}
                  className={`text-[11px] py-1 px-2 rounded transition-colors ${
                    active
                      ? "bg-white text-black"
                      : disabled
                        ? "bg-white/[0.02] text-white/25 cursor-not-allowed"
                        : "bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                  title={disabled ? "not yet generated" : undefined}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="text-[9px] text-white/30 mb-2 leading-tight">
            <span className="text-white/50">·</span> = LLM scene not yet generated
            {arcSkeleton ? (
              <span className="ml-1 text-emerald-400/60">
                ep {currentEpisode} ✓
              </span>
            ) : (
              <span className="ml-1 text-white/30">arc pending</span>
            )}
            <span className="ml-1 text-white/40">
              · {generatedCount} llm scenes
            </span>
          </div>

          <button
            onClick={() => setShowTranscripts((v) => !v)}
            className="w-full text-[10px] text-white/50 hover:text-white/90 py-1 border border-white/10 rounded mb-2 transition-colors flex items-center justify-center gap-1"
          >
            <span>{showTranscripts ? "▾" : "▸"}</span>
            <span>SCENE TRANSCRIPTS</span>
          </button>

          {showTranscripts && (
            <div className="max-h-[60vh] overflow-y-auto pr-1 mb-2 space-y-3">
              {SCENES.map((scene) => (
                <div
                  key={`auth-${scene.id}`}
                  className="border border-white/10 rounded p-2 bg-white/[0.03]"
                >
                  <div className="text-[10px] tracking-widest uppercase text-white/60 mb-1.5 flex justify-between gap-2">
                    <span>{scene.title}</span>
                    <span className="text-emerald-400/50">authored</span>
                  </div>
                  <div className="space-y-1.5">
                    {scene.dialogue.map((line, i) => (
                      <div key={i} className="text-[11px] leading-snug">
                        {line.speaker ? (
                          <span className="text-white/40">
                            {line.speaker}:{" "}
                          </span>
                        ) : (
                          <span className="text-white/30 italic">
                            (narration){" "}
                          </span>
                        )}
                        <span className="text-white/85">{line.text}</span>
                      </div>
                    ))}
                  </div>
                  {scene.textInput && (
                    <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-white/50">
                      <span className="uppercase tracking-widest text-white/40">
                        text input →
                      </span>{" "}
                      <span className="italic text-white/65">
                        {scene.textInput.placeholder}
                      </span>
                      <span className="text-white/35">
                        {" "}
                        ({scene.textInput.extractAs})
                      </span>
                    </div>
                  )}
                  {scene.choices && (
                    <div className="mt-2 pt-2 border-t border-white/10 space-y-0.5">
                      {scene.choices.map((c) => (
                        <div
                          key={c.id}
                          className="text-[10px] text-white/55 leading-snug"
                        >
                          <span className="text-white/35">
                            {c.id.toUpperCase()}.
                          </span>{" "}
                          {c.label}{" "}
                          <span className="text-white/35 tabular-nums">
                            (h{c.hype >= 0 ? "+" : ""}
                            {c.hype} · i{c.integrity >= 0 ? "+" : ""}
                            {c.integrity})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Rolling story-so-far summary */}
              {storySoFar && (
                <div className="border border-rose-400/30 rounded p-2 bg-rose-400/[0.04]">
                  <div className="text-[10px] tracking-widest uppercase text-rose-400/70 mb-1.5">
                    Story So Far (rolling)
                  </div>
                  <div className="text-[11px] text-white/80 italic leading-snug">
                    {storySoFar}
                  </div>
                </div>
              )}

              {/* Current episode skeleton */}
              {arcSkeleton && (
                <div className="border border-amber-400/30 rounded p-2 bg-amber-400/[0.04]">
                  <div className="text-[10px] tracking-widest uppercase text-amber-400/70 mb-1.5 flex justify-between gap-2">
                    <span>Episode {arcSkeleton.episodeIndex} skeleton</span>
                    <span>{arcSkeleton.cast.length} cast · {arcSkeleton.scenes.length} scenes</span>
                  </div>
                  <div className="text-[11px] text-white/85 mb-1 leading-snug font-semibold">
                    {arcSkeleton.theme}
                  </div>
                  <div className="text-[11px] text-white/65 italic mb-2 leading-snug">
                    {arcSkeleton.premise}
                  </div>
                  <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">
                    Cast
                  </div>
                  <div className="space-y-0.5 mb-2">
                    {arcSkeleton.cast.map((c, i) => (
                      <div
                        key={`cast-${i}`}
                        className="text-[10px] text-white/60 leading-snug"
                      >
                        <span className="text-white/40">{c.role}:</span>{" "}
                        <span className="text-white/85">{c.name}</span>
                        {c.blurb ? (
                          <span className="text-white/45"> — {c.blurb}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">
                    Scenes
                  </div>
                  <div className="space-y-1">
                    {arcSkeleton.scenes.map((s) => (
                      <div
                        key={`plan-${s.index}`}
                        className="text-[10px] text-white/60 leading-snug"
                      >
                        <span className="text-white/85">
                          {s.index + 1}. {s.title}
                        </span>{" "}
                        <span className="text-white/45">— {s.role}</span>
                        <div className="text-white/45 italic ml-2">
                          {s.setting}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All generated LLM scenes, with episode dividers */}
              {dynamicScenes
                .map((scene, llmIndex) => ({ scene, llmIndex }))
                .filter(({ scene }) => scene && scene.dialogue.length > 0)
                .map(({ scene, llmIndex }) => {
                  const epi = Math.floor(llmIndex / EPISODE_LENGTH_DEFAULT);
                  const positionInEpi = llmIndex % EPISODE_LENGTH_DEFAULT;
                  return (
                    <DynamicSceneCard
                      key={`llm-${llmIndex}`}
                      scene={scene}
                      llmIndex={llmIndex}
                      episodeIndex={epi}
                      positionInEpisode={positionInEpi}
                    />
                  );
                })}

              {generatedCount === 0 && arcSkeleton && (
                <div className="text-[10px] text-white/40 italic text-center py-2">
                  Awaiting first LLM scene…
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 mb-1">
            <button
              onClick={skipOnboarding}
              className="text-[10px] text-amber-200/80 hover:text-amber-100 py-1 border border-amber-300/30 rounded transition-colors"
              title="Wipe session, inject hardcoded intro, jump to scene 3"
            >
              SKIP ONBOARDING
            </button>
            <button
              onClick={wipeSession}
              className="text-[10px] text-rose-300/80 hover:text-rose-200 py-1 border border-rose-400/30 rounded transition-colors"
              title="Reset Zustand store and clear sessionStorage"
            >
              WIPE SESSION
            </button>
          </div>

          <button
            onClick={skipScene}
            disabled={phase !== "scene"}
            className="w-full text-[10px] text-violet-200/80 hover:text-violet-100 py-1 border border-violet-300/30 rounded transition-colors mb-1 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Record a [dev skip] choice and advance to next scene — fastest way to fast-forward through a run"
          >
            SKIP SCENE →
          </button>

          <button
            onClick={togglePaywall}
            className="w-full text-[10px] text-sky-200/80 hover:text-sky-100 py-1 border border-sky-300/30 rounded transition-colors mb-1"
            title="Open or close the paywall overlay without disturbing scene state"
          >
            {paywallOpen ? "HIDE PAYWALL" : "SHOW PAYWALL"}
          </button>

          <button
            onClick={grantSixCredits}
            className="w-full text-[10px] text-emerald-200/80 hover:text-emerald-100 py-1 border border-emerald-300/30 rounded transition-colors mb-1"
            title="Mark paid + add 6 credits without going through Stripe"
          >
            +6 CREDITS (NO PAYMENT)
          </button>
        </div>
      )}
    </div>
  );
}

function DynamicSceneCard({
  scene,
  llmIndex,
  episodeIndex,
  positionInEpisode,
}: {
  scene: LLMScene;
  llmIndex: number;
  episodeIndex: number;
  positionInEpisode: number;
}) {
  return (
    <div className="border border-sky-400/30 rounded p-2 bg-sky-400/[0.04]">
      <div className="text-[10px] tracking-widest uppercase text-sky-400/70 mb-1.5 flex justify-between gap-2">
        <span>{scene.title || `Scene ${AUTHORED_SCENE_COUNT + llmIndex + 1}`}</span>
        <span>
          ep {episodeIndex}.{positionInEpisode} · {scene.role}
        </span>
      </div>
      <div className="space-y-1.5">
        {scene.dialogue.map((line, i) => {
          const formatted = formatRoleSpeaker(line.speaker);
          return (
            <div key={i} className="text-[11px] leading-snug">
              {formatted ? (
                <span className="text-white/40">{formatted}: </span>
              ) : (
                <span className="text-white/30 italic">(narration) </span>
              )}
              <span className="text-white/85">{line.text}</span>
            </div>
          );
        })}
      </div>
      {scene.choices.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/10 space-y-0.5">
          {scene.choices.map((c) => (
            <div
              key={c.id}
              className="text-[10px] text-white/55 leading-snug"
            >
              <span className="text-white/35">{c.id.toUpperCase()}.</span>{" "}
              {c.label}{" "}
              <span className="text-white/35 tabular-nums">
                (h{c.hype >= 0 ? "+" : ""}
                {c.hype} · i{c.integrity >= 0 ? "+" : ""}
                {c.integrity})
              </span>
            </div>
          ))}
        </div>
      )}
      {scene.imagePrompt && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-white/45 leading-snug">
          <span className="uppercase tracking-widest text-white/35">img →</span>{" "}
          <span className="italic">{scene.imagePrompt}</span>
        </div>
      )}
    </div>
  );
}
