"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DialogueSubtitleProps {
  /** The full text to animate in, word by word. */
  text: string;
  /** Speaker name shown as a small label above the text. */
  speaker?: string;
  /**
   * Milliseconds between each word appearing.
   * Default: 110ms — matches natural speech cadence at ~5 words/sec.
   */
  wordInterval?: number;
  /** Called once the last word has appeared. */
  onComplete?: () => void;
  /** Skip animation and show all text immediately (e.g. when replaying). */
  instant?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DialogueSubtitle({
  text,
  speaker,
  wordInterval = 110,
  onComplete,
  instant = false,
}: DialogueSubtitleProps) {
  const words = text.trim().split(/\s+/);
  const [visibleCount, setVisibleCount] = useState(instant ? words.length : 0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Reset when text changes
  useEffect(() => {
    setVisibleCount(instant ? words.length : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, instant]);

  // Tick words in one at a time
  useEffect(() => {
    if (instant) return;
    if (visibleCount >= words.length) {
      onCompleteRef.current?.();
      return;
    }

    const id = setTimeout(() => {
      setVisibleCount((n) => n + 1);
    }, wordInterval);

    return () => clearTimeout(id);
  }, [visibleCount, words.length, wordInterval, instant]);

  return (
    <div className="w-full max-w-2xl mx-auto px-2 select-none">
      {/* Speaker label */}
      {speaker && (
        <p
          className="text-white/40 text-xs tracking-widest uppercase mb-2 font-medium"
          style={{ letterSpacing: "0.18em" }}
        >
          {speaker}
        </p>
      )}

      {/* Subtitle line */}
      <p
        className="text-white text-lg leading-snug font-normal"
        style={{ textShadow: "0 2px 12px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)" }}
        aria-live="polite"
        aria-label={text}
      >
        {words.map((word, i) => {
          const visible = i < visibleCount;
          const isCurrent = i === visibleCount - 1;

          return (
            <span
              key={`${text}-${i}`}
              className="inline-block mr-[0.3em]"
              style={{
                opacity: visible ? 1 : 0,
                // Current word gets a brief brightness flash as it lands
                filter: isCurrent ? "brightness(1.4)" : "brightness(1)",
                transition: visible
                  ? "opacity 0.12s ease, filter 0.35s ease"
                  : "none",
              }}
            >
              {word}
            </span>
          );
        })}
      </p>
    </div>
  );
}
