"use client";

import { useSessionStore } from "@/lib/session";

export default function UsageWidget() {
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const playsRemaining = useSessionStore((s) => s.playsRemaining);
  const phase = useSessionStore((s) => s.phase);

  if (!hasHydrated) return null;
  if (phase === "paywall") return null;

  const empty = playsRemaining <= 0;

  return (
    <div
      className="fixed top-5 right-6 z-30 select-none pointer-events-none"
      aria-live="polite"
    >
      <div
        className="comic-outline-sm flex items-center gap-2 px-3 py-1.5 rounded-lg"
        style={{
          background: empty ? "var(--color-cable)" : "var(--color-fog)",
          color: empty ? "var(--color-fog)" : "var(--color-ink)",
          transform: "rotate(-0.4deg)",
        }}
      >
        <span
          className="text-[9px] font-bold tracking-[0.24em] uppercase opacity-70"
        >
          Plays
        </span>
        <span className="text-base font-bold leading-none tabular-nums">
          {playsRemaining}
        </span>
      </div>
    </div>
  );
}
