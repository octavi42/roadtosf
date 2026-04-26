import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameShellProps {
  /** URL of the generated scene image. Pass null to show the placeholder gradient. */
  backgroundSrc: string | null;
  /** Slot rendered in the top-right corner of the HUD bar. */
  muteButton?: ReactNode;
  /** Main scene content rendered centred in the viewport. */
  children?: ReactNode;
  /**
   * Dialogue subtitle — always pinned at a fixed position above the choices.
   * Position never shifts whether choices are visible or not.
   */
  dialogueSlot?: ReactNode;
  /**
   * Choice buttons / text input — rendered directly below the dialogue slot.
   * When null the space collapses but dialogueSlot stays at the same y position.
   */
  bottomPanel?: ReactNode;
}

// ---------------------------------------------------------------------------
// GameShell
// ---------------------------------------------------------------------------

export function GameShell({
  backgroundSrc,
  muteButton,
  children,
  dialogueSlot,
  bottomPanel,
}: GameShellProps) {
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: "var(--color-fog)" }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Layer 0 — background                                                */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="absolute inset-0"
        style={{ zIndex: 0 }}
        aria-hidden="true"
      >
        {backgroundSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backgroundSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              filter: "saturate(1.15) contrast(1.05)",
            }}
          />
        ) : (
          <div
            className="absolute inset-0 paper-grain"
            style={{
              background:
                "radial-gradient(ellipse at 50% 30%, var(--color-sunset) 0%, var(--color-fog) 60%, var(--color-fog-soft) 100%)",
            }}
          />
        )}

        {/* Halftone dot overlay for comic texture */}
        <div
          className="absolute inset-0 halftone pointer-events-none"
          style={{ opacity: 0.35, mixBlendMode: "multiply" }}
        />

        {/* Soft top-down wash — keeps speech bubble legible without going dark */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(to top, rgba(244,237,226,0.55) 0%, rgba(244,237,226,0.2) 30%, rgba(244,237,226,0) 60%, rgba(244,237,226,0.25) 100%)",
          }}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Layer 1 — content                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="relative flex flex-col"
        style={{ zIndex: 10, height: "100dvh" }}
      >
        {/* Top bar -------------------------------------------------------- */}
        <header className="flex items-center justify-between px-6 pt-5 pb-3">
          <span
            className="comic-outline-sm font-display uppercase font-bold comic-tilt-l"
            style={{
              background: "var(--color-cable)",
              color: "var(--color-fog)",
              padding: "0.35rem 0.85rem",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
              letterSpacing: "0.18em",
            }}
          >
            ROAD TO SF
          </span>
          <div>{muteButton}</div>
        </header>

        {/* Main — fills the viewport centre, scene-label / intro cards live here */}
        <main className="flex flex-1 items-center justify-center px-4">
          {children}
        </main>

        {/* ---------------------------------------------------------------- */}
        {/* Fixed bottom block                                               */}
        {/* ---------------------------------------------------------------- */}
        <div className="w-full flex flex-col gap-3 px-6 pb-8 pt-2">
          {/* Dialogue subtitle — fixed anchor point */}
          <div className="min-h-[5rem] flex items-end">
            {dialogueSlot ?? null}
          </div>

          {/* Choice / text-input panel — only occupies space when present */}
          {bottomPanel && <div>{bottomPanel}</div>}
        </div>
      </div>
    </div>
  );
}
