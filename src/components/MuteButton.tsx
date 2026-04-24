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
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
        isMuted
          ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
          : "border-white/20 bg-white/5 text-white/70 hover:bg-white/10",
      ].join(" ")}
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
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span>Voice</span>
        </>
      )}
    </button>
  )
}
