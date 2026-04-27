"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ShareNotificationState = "hidden" | "docked" | "expanded";

interface ShareNotificationProps {
  visible: boolean;
  title: string;
  blurb: string;
  /** How long the auto-opened card stays expanded before collapsing back. */
  expandedDurationMs?: number;
  /** Delay before the docked pill auto-expands on first appearance. */
  expandAfterMs?: number;
  onShare?: () => void;
  onDismiss?: () => void;
}

const EXPANDED_DURATION_DEFAULT = 2000;
const EXPAND_AFTER_DEFAULT = 700;

export function ShareNotification({
  visible,
  title,
  blurb,
  expandedDurationMs = EXPANDED_DURATION_DEFAULT,
  expandAfterMs = EXPAND_AFTER_DEFAULT,
  onShare,
  onDismiss,
}: ShareNotificationProps) {
  const [state, setState] = useState<ShareNotificationState>("hidden");
  // Drives the entry fade. Can't use the existing `animate-bounce-in`
  // keyframes because they animate `transform`, which clobbers the morph's
  // inline translate(-50%, -50%) and shoves the box off-center.
  const [entered, setEntered] = useState(false);
  // Auto-sequence timers held in a ref so any manual interaction can cancel
  // them — otherwise the auto-collapse can slam-close a card the user just
  // re-opened by tapping the docked pill.
  const autoTimersRef = useRef<{
    expand?: ReturnType<typeof setTimeout>;
    collapse?: ReturnType<typeof setTimeout>;
  }>({});
  const cancelAutoTimers = useCallback(() => {
    if (autoTimersRef.current.expand) clearTimeout(autoTimersRef.current.expand);
    if (autoTimersRef.current.collapse) clearTimeout(autoTimersRef.current.collapse);
    autoTimersRef.current = {};
  }, []);

  useEffect(() => {
    // Effect runs only when `visible` flips, so the setState calls here are a
    // synchronisation step (incoming prop → local state machine), not the
    // cascading-render pattern the lint rule guards against.
    if (!visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntered(false);
      cancelAutoTimers();
      return setState("hidden");
    }
    // First-show sequence: appear docked at the left → auto-expand → auto-collapse.
    setState("docked");
    const raf = requestAnimationFrame(() => setEntered(true));
    autoTimersRef.current.expand = setTimeout(() => {
      setState((s) => (s === "docked" ? "expanded" : s));
    }, expandAfterMs);
    autoTimersRef.current.collapse = setTimeout(() => {
      setState((s) => (s === "expanded" ? "docked" : s));
      autoTimersRef.current = {};
    }, expandAfterMs + expandedDurationMs);
    return () => {
      cancelAnimationFrame(raf);
      cancelAutoTimers();
    };
  }, [visible, expandAfterMs, expandedDurationMs, cancelAutoTimers]);

  if (state === "hidden") return null;

  const isCard = state === "expanded";

  // Single fixed box morphs between two layouts, both anchored top-left:
  //  - docked: small pill stacked under the scene-title pill
  //  - expanded: full card growing in place from the docked position
  const positionByState: Record<
    Exclude<ShareNotificationState, "hidden">,
    Pick<React.CSSProperties, "left" | "top" | "transform">
  > = {
    docked: { left: 24, top: 108, transform: "none" },
    expanded: { left: 24, top: 108, transform: "none" },
  };
  // Explicit heights for both modes — `height: auto` can't be animated, which
  // is what made the height pop before the width caught up. Card content
  // sits inside an overflow-hidden container so the fixed 224px clips
  // gracefully if the blurb runs long.
  const CARD_HEIGHT = 224;
  const DOCKED_HEIGHT = 32;
  const EASE = "cubic-bezier(0.32, 1.05, 0.6, 1)";
  const DUR = "260ms";
  const props = ["width", "height", "padding", "border-radius", "left", "top", "transform", "background-color"];
  const containerStyle: React.CSSProperties = {
    background: isCard ? "var(--color-fog)" : "var(--color-mustard)",
    color: "var(--color-ink)",
    width: isCard ? 340 : 110,
    height: isCard ? CARD_HEIGHT : DOCKED_HEIGHT,
    padding: isCard ? "1rem 1.1rem" : "0",
    borderRadius: isCard ? 14 : 8,
    ...positionByState[state],
    opacity: entered ? 1 : 0,
    transition: `opacity 220ms ease, ${props.map((p) => `${p} ${DUR} ${EASE}`).join(", ")}`,
    overflow: "hidden",
    cursor: state === "docked" ? "pointer" : "default",
  };

  const expandFromDock = () => {
    cancelAutoTimers();
    setState("expanded");
  };
  const collapseToDock = () => {
    cancelAutoTimers();
    setState("docked");
  };

  return (
    <div
      className={`fixed ${isCard ? "comic-outline" : "comic-outline-sm"}`}
      style={{ ...containerStyle, zIndex: 40 }}
      onClick={state === "docked" ? expandFromDock : undefined}
      onKeyDown={
        state === "docked"
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                expandFromDock();
              }
            }
          : undefined
      }
      role={state === "docked" ? "button" : undefined}
      tabIndex={state === "docked" ? 0 : -1}
      aria-label={state === "docked" ? "Open share moment" : undefined}
    >
      {/* Card layout — visible when expanded */}
      <div
        style={{
          opacity: isCard ? 1 : 0,
          transition: isCard
            ? "opacity 160ms ease 100ms"
            : "opacity 100ms ease",
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
              collapseToDock();
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
              cancelAutoTimers();
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
              collapseToDock();
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

      {/* Docked pill — matches the ROAD TO SF / scene-title badge style */}
      <div
        className="absolute inset-0 flex items-center justify-center font-display font-bold uppercase whitespace-nowrap"
        style={{
          opacity: state === "docked" ? 1 : 0,
          transition:
            state === "docked"
              ? "opacity 160ms ease 100ms"
              : "opacity 100ms ease",
          pointerEvents: state === "docked" ? "auto" : "none",
          fontSize: "0.78rem",
          letterSpacing: "0.16em",
          gap: "0.4rem",
        }}
        aria-hidden={state !== "docked"}
      >
        <span aria-hidden="true">📣</span>
        <span>Share</span>
      </div>
    </div>
  );
}
