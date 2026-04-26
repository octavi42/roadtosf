"use client"

import { useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react"
import MuteButton from "./MuteButton"

interface TextInputPanelProps {
  placeholder?: string
  onSubmit: (text: string) => void
  disabled?: boolean
  maxLength?: number
  isMuted?: boolean
  onMuteToggle?: () => void
}

export default function TextInputPanel({
  placeholder = "Type your response…",
  onSubmit,
  disabled = false,
  maxLength = 280,
  isMuted,
  onMuteToggle,
}: TextInputPanelProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const LINE_HEIGHT = 24
  const MIN_ROWS = 1
  const MAX_ROWS = 4

  function recalcHeight(el: HTMLTextAreaElement) {
    el.style.height = "auto"
    const scrollH = el.scrollHeight
    const maxH = LINE_HEIGHT * MAX_ROWS + 16
    el.style.height = `${Math.min(scrollH, maxH)}px`
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    if (next.length > maxLength) return
    setValue(next)
    recalcHeight(e.target)
  }

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setValue("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, disabled, onSubmit])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const used = value.length
  const pct = used / maxLength

  const counterColor =
    used >= maxLength
      ? "text-[var(--color-cable)]"
      : pct > 0.8
      ? "text-[var(--color-sunset-deep)]"
      : "text-[var(--color-ink)]/50"

  return (
    <div
      className="comic-outline rounded-2xl px-5 py-4 w-full max-w-2xl mx-auto animate-bounce-in"
      style={{ background: "var(--color-fog)" }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={MIN_ROWS}
        className="font-sans w-full bg-transparent text-[var(--color-ink)] text-base resize-none outline-none placeholder-[var(--color-ink)]/40 leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ minHeight: `${LINE_HEIGHT * MIN_ROWS}px` }}
      />

      <div className="flex items-center justify-between mt-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {isMuted !== undefined && onMuteToggle && (
            <MuteButton isMuted={isMuted} onToggle={onMuteToggle} />
          )}
          <span
            className="font-pixel text-[var(--color-ink)]/50 text-sm select-none truncate"
            style={{ letterSpacing: "0.05em" }}
          >
            ↵ send · ⇧↵ newline
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`font-pixel text-sm tabular-nums transition-colors ${counterColor}`}
          >
            {used}/{maxLength}
          </span>
          <button
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            className="comic-outline-sm comic-press font-sans font-semibold rounded-lg px-3 py-1.5 text-[var(--color-ink)] text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "var(--color-mustard)",
              letterSpacing: "-0.005em",
            }}
          >
            Send →
          </button>
        </div>
      </div>
    </div>
  )
}
