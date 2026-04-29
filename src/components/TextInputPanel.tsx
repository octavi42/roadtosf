"use client"

import { useRef, useState, useCallback, KeyboardEvent, ChangeEvent } from "react"

import { useScribe, CommitStrategy } from "@elevenlabs/react"

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
  const [isListening, setIsListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Snapshot of `value` at the moment the player started recording.
  // Committed segments concatenate onto this snapshot. The live partial
  // transcript is overlaid on top while the player keeps speaking, so
  // `value` mutates each frame the model issues a new partial.
  const baseValueRef = useRef("")

  const handlePartial = useCallback((data: { text: string }) => {
    const partial = data.text.trim()
    const base = baseValueRef.current
    const next = base ? `${base.trimEnd()} ${partial}` : partial
    setValue(next.slice(0, maxLength))
  }, [maxLength])

  const handleCommitted = useCallback((data: { text: string }) => {
    const segment = data.text.trim()
    if (!segment) return
    const base = baseValueRef.current
    baseValueRef.current = base
      ? `${base.trimEnd()} ${segment}`
      : segment
    setValue(baseValueRef.current.slice(0, maxLength))
  }, [maxLength])

  const handleScribeError = useCallback((err: Error | Event) => {
    const message = err instanceof Error ? err.message : "voice error"
    setVoiceError(message)
    setIsListening(false)
  }, [])

  const { partialTranscript, connect, disconnect, commit } = useScribe({
    onPartialTranscript: handlePartial,
    onCommittedTranscript: handleCommitted,
    onError: handleScribeError,
    onAuthError: (data) => handleScribeError(new Error(data.error)),
    onTranscriberError: (data) => handleScribeError(new Error(data.error)),
    onDisconnect: () => setIsListening(false),
  })

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
    // Truncate rather than drop — pasting a block longer than maxLength
    // would otherwise look like paste was silently broken.
    const next = e.target.value.slice(0, maxLength)
    setValue(next)
    recalcHeight(e.target)
  }

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setValue("")
    baseValueRef.current = ""
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

  const startListening = useCallback(async () => {
    setVoiceError(null)
    try {
      const tokenRes = await fetch("/api/scribe-token", { method: "POST" })
      if (!tokenRes.ok) {
        throw new Error(`token http ${tokenRes.status}`)
      }
      const body = (await tokenRes.json()) as { token?: string; error?: string }
      if (!body.token) {
        throw new Error(body.error ?? "no token returned")
      }
      // Anchor incoming committed segments onto whatever the player has
      // already typed.
      baseValueRef.current = value
      await connect({
        token: body.token,
        modelId: "scribe_v2_realtime",
        commitStrategy: CommitStrategy.MANUAL,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      setIsListening(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : "voice start failed"
      setVoiceError(message)
      setIsListening(false)
    }
  }, [connect, value])

  const stopListening = useCallback(() => {
    try {
      commit()
    } catch {
      // commit() throws if the connection already closed — fine to ignore.
    }
    disconnect()
    setIsListening(false)
  }, [commit, disconnect])

  const onVoiceClick = isListening ? stopListening : startListening

  const used = value.length
  const pct = used / maxLength

  const counterColor =
    used >= maxLength
      ? "text-[var(--color-cable)]"
      : pct > 0.8
      ? "text-[var(--color-sunset-deep)]"
      : "text-[var(--color-ink)]/50"

  const textareaDisabled = disabled || isListening
  const displayValue =
    isListening && partialTranscript
      ? `${baseValueRef.current ? baseValueRef.current.trimEnd() + " " : ""}${partialTranscript}`.slice(
          0,
          maxLength,
        )
      : value

  return (
    <div
      className="comic-outline rounded-2xl px-5 py-4 w-full max-w-2xl mx-auto animate-bounce-in"
      style={{ background: "var(--color-fog)" }}
    >
      <textarea
        ref={textareaRef}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={textareaDisabled}
        placeholder={isListening ? "Listening… speak now" : placeholder}
        rows={MIN_ROWS}
        className="font-sans w-full bg-transparent text-[var(--color-ink)] text-base resize-none outline-none placeholder-[var(--color-ink)]/40 leading-relaxed disabled:cursor-not-allowed"
        style={{
          minHeight: `${LINE_HEIGHT * MIN_ROWS}px`,
          opacity: textareaDisabled && !isListening ? 0.4 : 1,
        }}
      />

      <div className="flex items-center justify-between mt-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onVoiceClick}
            disabled={disabled}
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
            aria-pressed={isListening}
            className={[
              "comic-outline-sm comic-press flex items-center gap-1.5 px-3 py-1.5",
              "rounded-full font-sans uppercase text-xs font-bold",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            ].join(" ")}
            style={{
              background: isListening
                ? "var(--color-cable)"
                : "var(--color-mint)",
              color: isListening ? "var(--color-fog)" : "var(--color-ink)",
              letterSpacing: "0.08em",
            }}
          >
            <span aria-hidden="true">🎙</span>
            {isListening && (
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: "var(--color-fog)" }}
              />
            )}
            <span>{isListening ? "Listening…" : "Voice"}</span>
          </button>

          {!isListening && !voiceError && (
            <span
              className="font-pixel text-[var(--color-ink)]/50 text-sm select-none truncate"
              style={{ letterSpacing: "0.05em" }}
            >
              ↵ send · ⇧↵ newline
            </span>
          )}

          {voiceError && (
            <span
              className="font-sans text-[var(--color-cable)] text-xs select-none truncate"
              role="alert"
            >
              {voiceError}
            </span>
          )}
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
