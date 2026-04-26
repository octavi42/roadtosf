"use client";

import { useEffect, useState } from "react";
import { useSessionStore, type Phase } from "@/lib/session";

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

export default function DevPanel() {
  const [open, setOpen] = useState(false);
  const phase = useSessionStore((s) => s.phase);
  const sceneIndex = useSessionStore((s) => s.progress.sceneIndex);
  const devSetPhase = useSessionStore((s) => s.devSetPhase);

  const [, setTick] = useState(0);

  useEffect(() => {
    const onStorage = () => setTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (process.env.NODE_ENV !== "development") return null;

  const goTo = (target: DevTarget) => {
    window.localStorage.setItem(
      DEV_OVERRIDE_KEY,
      JSON.stringify({ phase: target.phase, sceneIndex: target.sceneIndex }),
    );
    devSetPhase(target.phase, target.sceneIndex);
    setTick((t) => t + 1);
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
        <div className="bg-black/90 border border-white/20 rounded-lg p-3 w-60 backdrop-blur shadow-2xl">
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
