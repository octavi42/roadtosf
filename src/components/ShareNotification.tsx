"use client";

import { useEffect, useState } from "react";

export type ShareNotificationState = "hidden" | "peek" | "docked" | "expanded";

interface ShareNotificationProps {
  visible: boolean;
  title: string;
  blurb: string;
  peekDurationMs?: number;
  onShare?: () => void;
  onDismiss?: () => void;
}

const PEEK_DURATION_DEFAULT = 4000;

export function ShareNotification({
  visible,
  title,
  blurb,
  peekDurationMs = PEEK_DURATION_DEFAULT,
  onShare,
  onDismiss,
}: ShareNotificationProps) {
  const [state, setState] = useState<ShareNotificationState>("hidden");

  useEffect(() => {
    // Effect runs only when `visible` flips, so the setState calls here are a
    // synchronisation step (incoming prop → local state machine), not the
    // cascading-render pattern the lint rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible) return setState("hidden");
    setState("peek");
    const t = setTimeout(() => {
      setState((s) => (s === "peek" ? "docked" : s));
    }, peekDurationMs);
    return () => clearTimeout(t);
  }, [visible, peekDurationMs]);

  if (state === "hidden") return null;

  const isCard = state === "peek" || state === "expanded";
  const isPeek = state === "peek";

  // Single fixed box morphs between three layouts.
  //  - peek: top-center toast
  //  - expanded: anchored to left edge, full card
  //  - docked: collapsed pill at left edge (icon only)
  const containerStyle: React.CSSProperties = {
    background: isCard ? "var(--color-fog)" : "var(--color-mustard)",
    color: "var(--color-ink)",
    width: isCard ? 340 : 56,
    minHeight: 56,
    padding: isCard ? "1rem 1.1rem" : "0",
    borderRadius: 14,
    left: isPeek ? "50%" : 12,
    top: isPeek ? 84 : "50%",
    transform: isPeek
      ? "translateX(-50%)"
      : "translateY(-50%)",
    transition:
      "width 360ms cubic-bezier(0.34, 1.56, 0.64, 1), padding 360ms ease, border-radius 360ms ease, background-color 240ms ease, left 360ms cubic-bezier(0.34, 1.56, 0.64, 1), top 360ms cubic-bezier(0.34, 1.56, 0.64, 1), transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1)",
    overflow: "hidden",
    cursor: state === "docked" ? "pointer" : "default",
  };

  return (
    <div
      className="fixed comic-outline animate-bounce-in"
      style={{ ...containerStyle, zIndex: 40 }}
      onClick={state === "docked" ? () => setState("expanded") : undefined}
      role={state === "docked" ? "button" : undefined}
      aria-label={state === "docked" ? "Open share moment" : undefined}
    >
      {/* Card layout — visible when peek or expanded */}
      <div
        style={{
          opacity: isCard ? 1 : 0,
          transition: isCard
            ? "opacity 220ms ease 140ms"
            : "opacity 140ms ease",
          pointerEvents: isCard ? "auto" : "none",
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div
            className="font-display font-bold uppercase text-[11px] tracking-[0.18em]"
            style={{ color: "var(--color-cable)" }}
          >
            📣 Share Moment
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setState("docked");
              onDismiss?.();
            }}
            className="text-base leading-none"
            aria-label="Collapse share moment"
            style={{ color: "var(--color-ink)" }}
          >
            ✕
          </button>
        </div>
        <div className="font-display font-bold text-base leading-tight mb-1.5">
          {title}
        </div>
        <p className="text-sm leading-relaxed mb-3">{blurb}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShare?.();
            }}
            className="comic-outline-sm comic-press flex-1 font-sans font-semibold uppercase tracking-[0.14em] text-[11px] py-2"
            style={{
              background: "var(--color-mustard)",
              color: "var(--color-ink)",
              borderRadius: 8,
            }}
          >
            Share on X
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setState("docked");
            }}
            className="comic-outline-sm comic-press font-sans font-semibold uppercase tracking-[0.14em] text-[11px] py-2 px-3"
            style={{
              background: "var(--color-fog)",
              color: "var(--color-ink)",
              borderRadius: 8,
            }}
          >
            Later
          </button>
        </div>
      </div>

      {/* Docked icon — visible only in docked state */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          opacity: state === "docked" ? 1 : 0,
          transition:
            state === "docked"
              ? "opacity 220ms ease 140ms"
              : "opacity 140ms ease",
          pointerEvents: state === "docked" ? "auto" : "none",
          fontSize: 24,
        }}
        aria-hidden={state !== "docked"}
      >
        📣
      </div>
    </div>
  );
}
