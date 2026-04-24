"use client"

import { useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react"

interface TextInputPanelProps {
  placeholder?: string
  onSubmit: (text: string) => void
  disabled?: boolean
  maxLength?: number
}

export default function TextInputPanel({
  placeholder = "Type your response…",
  onSubmit,
  disabled = false,
  maxLength = 280,
}: TextInputPanelProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const LINE_HEIGHT = 24 // px — matches leading-relaxed at text-sm (~14px * 1.625)
  const MIN_ROWS = 1
  const MAX_ROWS = 4

  function recalcHeight(el: HTMLTextAreaElement) {
    el.style.height = "auto"
    const scrollH = el.scrollHeight
    const maxH = LINE_HEIGHT * MAX_ROWS + 16 // +16 for padding
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
      ? "text-red-400"
      : pct > 0.8
      ? "text-amber-400"
      : "text-white/30"

  return (
    <div className="backdrop-panel rounded-2xl px-5 py-4 w-full max-w-2xl mx-auto animate-fade-slide-up">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={MIN_ROWS}
        className="w-full bg-transparent text-white text-sm resize-none outline-none placeholder-white/30 leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ minHeight: `${LINE_HEIGHT * MIN_ROWS}px` }}
      />

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-white/30 text-xs select-none">
          ↵ send &nbsp;·&nbsp; ⇧↵ newline
        </span>

        <div className="flex items-center gap-2">
          <span className={`text-xs tabular-nums transition-colors ${counterColor}`}>
            {used}/{maxLength}
          </span>
          <button
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            className="bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg px-3 py-1.5 text-white text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send →
          </button>
        </div>
      </div>
    </div>
  )
}
