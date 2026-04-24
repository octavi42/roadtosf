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
    <div className="fixed inset-0 overflow-hidden bg-black">
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
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 60% 40%, #1a1a2e 0%, #000 70%)",
            }}
          />
        )}

        {/* Vignette — heavier at the bottom so subtitle text is always legible */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 28%, rgba(0,0,0,0.08) 55%, rgba(0,0,0,0.35) 100%)",
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
            className="tracking-widest text-white/80"
            style={{
              fontVariant: "small-caps",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              fontWeight: 500,
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
        {/*                                                                  */}
        {/* dialogueSlot is ALWAYS rendered at the same y-position.          */}
        {/* bottomPanel slides in below it; when absent the outer padding     */}
        {/* holds the dialogue in place so it never jumps.                   */}
        {/* ---------------------------------------------------------------- */}
        <div className="w-full flex flex-col gap-3 px-6 pb-8 pt-2">
          {/* Dialogue subtitle — fixed anchor point */}
          <div className="min-h-[4.5rem] flex items-end">
            {dialogueSlot ?? null}
          </div>

          {/* Choice / text-input panel — only occupies space when present */}
          {bottomPanel && <div>{bottomPanel}</div>}
        </div>
      </div>
    </div>
  );
}
