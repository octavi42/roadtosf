"use client";

import { useSessionStore } from "@/lib/session";

export default function UsageWidget() {
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const creditsRemaining = useSessionStore((s) => s.creditsRemaining);
  const phase = useSessionStore((s) => s.phase);
  const paid = useSessionStore((s) => s.paid);

  if (!hasHydrated) return null;
  if (phase === "paywall") return null;
  // Pre-paywall (paid=false, the free authored prologue), credits aren't a
  // useful concept yet — hide so the widget doesn't read "0 Credits" while
  // the player is mid-trial.
  if (!paid) return null;

  const empty = creditsRemaining <= 0;

  return (
    <div
      className="fixed top-16 right-6 z-30 select-none pointer-events-none"
      aria-live="polite"
    >
      <div
        className="comic-outline-sm flex items-center gap-2 px-3 py-1.5 rounded-lg"
        style={{
          background: empty ? "var(--color-cable)" : "var(--color-fog)",
          color: empty ? "var(--color-fog)" : "var(--color-ink)",
          transform: "rotate(-0.4deg)",
        }}
        title="1 credit = 1 generated group of scenes"
      >
        <span
          className="text-[9px] font-bold tracking-[0.24em] uppercase opacity-70"
        >
          Credits
        </span>
        <span className="text-base font-bold leading-none tabular-nums">
          {creditsRemaining}
        </span>
      </div>
    </div>
  );
}
