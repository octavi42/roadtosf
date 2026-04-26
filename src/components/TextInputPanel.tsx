"use client"

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  KeyboardEvent,
  ChangeEvent,
} from "react"

interface TextInputPanelProps {
  placeholder?: string
  onSubmit: (text: string) => void
  disabled?: boolean
  maxLength?: number
  /** ms between typed characters in the placeholder reveal */
  typeSpeedMs?: number
}

export default function TextInputPanel({
  placeholder = "Type your response…",
  onSubmit,
  disabled = false,
  maxLength = 280,
  typeSpeedMs = 38,
}: TextInputPanelProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const LINE_HEIGHT = 24
  const MIN_ROWS = 1
  const MAX_ROWS = 4

  // Typewriter placeholder ----------------------------------------------------
  const [typedCount, setTypedCount] = useState(0)
  const [showCursor, setShowCursor] = useState(true)

  // Reset typing when the placeholder string itself changes (e.g. Scene 3 swap)
  useEffect(() => {
    setTypedCount(0)
  }, [placeholder])

  // Type one character at a time until the placeholder is fully revealed
  useEffect(() => {
    if (typedCount >= placeholder.length) return
    const id = setTimeout(() => {
      setTypedCount((n) => n + 1)
    }, typeSpeedMs)
    return () => clearTimeout(id)
  }, [typedCount, placeholder, typeSpeedMs])

  // Blink the cursor — slightly slower than typing so it doesn't strobe
  useEffect(() => {
    const id = setInterval(() => setShowCursor((c) => !c), 530)
    return () => clearInterval(id)
  }, [])

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

  const typedSlice = placeholder.slice(0, typedCount)

  return (
    <div
      className="comic-outline rounded-2xl px-5 py-4 w-full max-w-2xl mx-auto animate-bounce-in"
      style={{ background: "var(--color-fog)" }}
    >
      <div className="relative">
        {/* Typewriter placeholder overlay — visible only when value is empty */}
        {value.length === 0 && (
          <div
            aria-hidden="true"
            className="font-sans pointer-events-none absolute inset-0 text-base leading-relaxed text-[var(--color-ink)]/40 select-none whitespace-pre-wrap break-words"
            style={{ minHeight: `${LINE_HEIGHT * MIN_ROWS}px` }}
          >
            {typedSlice}
            <span
              aria-hidden="true"
              style={{
                opacity: showCursor ? 1 : 0,
                transition: "opacity 80ms linear",
                color: "var(--color-ink)",
              }}
            >
              ▌
            </span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label={placeholder}
          rows={MIN_ROWS}
          className="font-sans relative w-full bg-transparent text-[var(--color-ink)] text-base resize-none outline-none leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ minHeight: `${LINE_HEIGHT * MIN_ROWS}px` }}
        />
      </div>

      <div className="flex items-center justify-between mt-3">
        <span
          className="font-pixel text-[var(--color-ink)]/50 text-sm select-none"
          style={{ letterSpacing: "0.05em" }}
        >
          ↵ send · ⇧↵ newline
        </span>

        <div className="flex items-center gap-2">
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
