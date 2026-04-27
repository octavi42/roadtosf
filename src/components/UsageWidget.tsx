"use client";

import { useSessionStore } from "@/lib/session";

export default function UsageWidget() {
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const creditsRemaining = useSessionStore((s) => s.creditsRemaining);
  const phase = useSessionStore((s) => s.phase);
  const paid = useSessionStore((s) => s.paid);

  if (!hasHydrated) return null;
  if (phase === "paywall") return null;
  // Show the widget when the player has either paid in this session OR
  // has a server-confirmed balance > 0 (e.g., a returning user who just
  // logged in via LoginModal, where `paid` was never flipped client-side
  // because no fresh Stripe verify ran). Pre-payment trial — anon, no
  // balance — keeps the widget hidden so it doesn't read "0 Credits"
  // during the free authored prologue.
  const empty = creditsRemaining <= 0;
  if (empty && !paid) return null;

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
