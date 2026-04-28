"use client";

import { useSessionStore } from "@/lib/session";
import { PACKS } from "@/lib/packs";

// Gauge max — biggest pack the player can buy. A full Business purchase
// fills the ring; smaller packs partially fill it.
const GAUGE_MAX = PACKS.business.credits;

export default function UsageWidget() {
  const hasHydrated = useSessionStore((s) => s.hasHydrated);
  const creditsRemaining = useSessionStore((s) => s.creditsRemaining);
  const paywallOpen = useSessionStore((s) => s.paywallOpen);
  const paid = useSessionStore((s) => s.paid);

  if (!hasHydrated) return null;
  if (paywallOpen) return null;
  // Show the widget when the player has either paid in this session OR
  // has a server-confirmed balance > 0 (e.g., a returning user who just
  // logged in via LoginModal, where `paid` was never flipped client-side
  // because no fresh Stripe verify ran). Pre-payment trial — anon, no
  // balance — keeps the widget hidden so it doesn't read "0 Credits"
  // during the free authored prologue.
  const empty = creditsRemaining <= 0;
  if (empty && !paid) return null;

  const fill = Math.max(0, Math.min(1, creditsRemaining / GAUGE_MAX));
  const circumference = 2 * Math.PI * 15.9155;
  const dash = circumference * fill;
  const label = `${creditsRemaining} credit${creditsRemaining === 1 ? "" : "s"} remaining — 1 credit = 1 generated group of scenes`;

  return (
    <div
      className="fixed top-16 right-6 z-30 select-none pointer-events-none"
      aria-live="polite"
      aria-label={label}
      title={label}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={GAUGE_MAX}
      aria-valuenow={creditsRemaining}
    >
      <div
        className="comic-outline-sm group pointer-events-auto relative flex h-10 w-10 items-center justify-end gap-0 overflow-hidden rounded-full pl-0 transition-[width,gap,padding-left] duration-300 ease-out hover:w-[5.5rem] hover:gap-1.5 hover:pl-3.5"
        style={{
          background: "var(--color-fog)",
          transform: "rotate(-2deg)",
        }}
      >
        <span
          aria-hidden
          className="text-sm font-extrabold leading-none tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-150"
          style={{ color: "var(--color-ink)" }}
        >
          {creditsRemaining}
        </span>
        <div className="relative h-10 w-10 shrink-0">
          <svg
            viewBox="0 0 36 36"
            className="absolute inset-1 -rotate-90"
            aria-hidden
          >
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              stroke="var(--color-cable)"
              strokeOpacity="0.18"
              strokeWidth="4"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: "stroke-dasharray 320ms ease-out" }}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
