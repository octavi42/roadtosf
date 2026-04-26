"use client"

interface MuteButtonProps {
  isMuted: boolean
  onToggle: () => void
}

export default function MuteButton({ isMuted, onToggle }: MuteButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={[
        "comic-outline-sm comic-press flex items-center gap-1.5 px-3 py-1.5",
        "rounded-full font-display text-[var(--color-ink)] uppercase",
        "text-xs font-bold tracking-wide comic-tilt-r",
      ].join(" ")}
      style={{
        background: isMuted ? "var(--color-mustard)" : "var(--color-mint)",
        letterSpacing: "0.08em",
      }}
      aria-label={isMuted ? "Switch to voice mode" : "Switch to text mode"}
    >
      {isMuted ? (
        <>
          <span aria-hidden="true">⌨</span>
          <span>Text</span>
        </>
      ) : (
        <>
          <span aria-hidden="true">🎙</span>
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "var(--color-cable)" }}
          />
          <span>Voice</span>
        </>
      )}
    </button>
  )
}
