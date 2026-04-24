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
  /** Controls / input bar anchored to the bottom of the screen. */
  bottomPanel?: ReactNode;
}

// ---------------------------------------------------------------------------
// GameShell
// ---------------------------------------------------------------------------

export function GameShell({
  backgroundSrc,
  muteButton,
  children,
  bottomPanel,
}: GameShellProps) {
  return (
    // Root: fills the viewport, clips everything, black base colour.
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
          /* Generated scene image */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backgroundSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          /* Placeholder: deep-space gradient before image loads */
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 60% 40%, #1a1a2e 0%, #000 70%)",
            }}
          />
        )}

        {/* Dark vignette — ensures text stays legible over any image */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0.40) 100%)",
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
          {/* Game title — HUD label style */}
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

          {/* Mute button slot */}
          <div>{muteButton}</div>
        </header>

        {/* Main / children ------------------------------------------------ */}
        <main className="flex flex-1 items-center justify-center px-4">
          {children}
        </main>

        {/* Bottom panel slot ---------------------------------------------- */}
        <footer className="w-full px-4 pb-6">{bottomPanel}</footer>
      </div>
    </div>
  );
}
