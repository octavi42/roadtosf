"use client";

import { useEffect, useState } from "react";
import { useSessionStore, type Phase } from "@/lib/session";
import { SCENES } from "@/lib/scenes";

const DEV_OVERRIDE_KEY = "rtsf_dev_phase";

interface DevTarget {
  label: string;
  phase: Phase;
  sceneIndex?: number;
}

const TARGETS: DevTarget[] = [
  { label: "Welcome", phase: "welcome" },
  { label: "Onboarding", phase: "onboarding" },
  { label: "Scene 1", phase: "scene", sceneIndex: 0 },
  { label: "Scene 2", phase: "scene", sceneIndex: 1 },
  { label: "Scene 3", phase: "scene", sceneIndex: 2 },
  { label: "Paywall", phase: "paywall" },
  { label: "Scene 4", phase: "scene", sceneIndex: 3 },
  { label: "Scene 5", phase: "scene", sceneIndex: 4 },
  { label: "Ending", phase: "ending" },
];

// Phases where downstream code (paywall, scene capture) assumes a playthrough
// row exists. When the dev jumps directly to one of these we backfill a stub
// row so the rest of the flow has something to attach to.
const PHASES_REQUIRING_PLAYTHROUGH: Phase[] = ["scene", "paywall", "ending"];

export default function DevPanel() {
  const [open, setOpen] = useState(false);
  const [showTranscripts, setShowTranscripts] = useState(false);
  const phase = useSessionStore((s) => s.phase);
  const sceneIndex = useSessionStore((s) => s.progress.sceneIndex);
  const devSetPhase = useSessionStore((s) => s.devSetPhase);
  const playthroughId = useSessionStore((s) => s.playthroughId);
  const setPlaythroughId = useSessionStore((s) => s.setPlaythroughId);

  const [, setTick] = useState(0);

  useEffect(() => {
    const onStorage = () => setTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (process.env.NODE_ENV !== "development") return null;

  const goTo = async (target: DevTarget) => {
    window.localStorage.setItem(
      DEV_OVERRIDE_KEY,
      JSON.stringify({ phase: target.phase, sceneIndex: target.sceneIndex }),
    );
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

  const clear = () => {
    window.localStorage.removeItem(DEV_OVERRIDE_KEY);
    devSetPhase("welcome");
    setTick((t) => t + 1);
  };

  const isActive = (target: DevTarget) =>
    phase === target.phase &&
    (target.sceneIndex === undefined || target.sceneIndex === sceneIndex);

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
            {TARGETS.map((t) => {
              const active = isActive(t);
              return (
                <button
                  key={t.label}
                  onClick={() => goTo(t)}
                  className={`text-[11px] py-1 px-2 rounded transition-colors ${
                    active
                      ? "bg-white text-black"
                      : "bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
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
                  key={scene.id}
                  className="border border-white/10 rounded p-2 bg-white/[0.03]"
                >
                  <div className="text-[10px] tracking-widest uppercase text-white/60 mb-1.5">
                    {scene.title}
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
            </div>
          )}

          <button
            onClick={clear}
            className="w-full text-[10px] text-white/40 hover:text-white/80 py-1 border border-white/10 rounded transition-colors"
          >
            CLEAR OVERRIDE
          </button>
        </div>
      )}
    </div>
  );
}
