"use client"

import { useEffect, useRef, useState } from "react"

interface Choice {
  id: string
  label: string
}

interface ChoicePanelProps {
  choices: Choice[]
  timeoutSeconds?: number
  onChoice: (id: string) => void
  disabled?: boolean
}

export default function ChoicePanel({
  choices,
  timeoutSeconds = 15,
  onChoice,
  disabled = false,
}: ChoicePanelProps) {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds)
  const [selected, setSelected] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasCalledRef = useRef(false)

  useEffect(() => {
    if (disabled) return

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          if (!hasCalledRef.current) {
            hasCalledRef.current = true
            onChoice("timeout")
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [disabled, onChoice])

  function handleChoice(id: string) {
    if (selected !== null || disabled || hasCalledRef.current) return
    hasCalledRef.current = true
    if (intervalRef.current) clearInterval(intervalRef.current)
    setSelected(id)
    onChoice(id)
  }

  const progress = (timeLeft / timeoutSeconds) * 100

  // Interpolate amber → red as time runs out
  // amber = hsl(38, 92%, 50%), red = hsl(0, 84%, 50%)
  const hue = Math.round(38 * (timeLeft / timeoutSeconds))
  const barColor = `hsl(${hue}, 90%, 52%)`

  return (
    <div className="backdrop-panel rounded-2xl px-6 py-4 w-full max-w-2xl mx-auto animate-fade-slide-up">
      {/* Timer bar */}
      <div className="w-full h-0.5 bg-white/10 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${progress}%`,
            backgroundColor: barColor,
          }}
        />
      </div>

      {/* Choices */}
      <div className="flex gap-3 justify-center flex-wrap">
        {choices.map((choice) => {
          const isSelected = selected === choice.id
          return (
            <button
              key={choice.id}
              onClick={() => handleChoice(choice.id)}
              disabled={selected !== null || disabled}
              className={[
                "flex-1 min-w-[140px] max-w-[220px] px-4 py-3 rounded-xl border text-white text-sm font-medium transition-all",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                isSelected
                  ? "border-white/60 bg-white/15 animate-pulse-glow"
                  : "border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/30",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {choice.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
