"use client";

import { useEffect, useRef, useState } from "react";

export interface DialogueSubtitleProps {
  text: string;
  wordInterval?: number;
  onComplete?: () => void;
  instant?: boolean;
}

type AnimPhase = "in" | "hold" | "out" | "done";

export default function DialogueSubtitle({
  text,
  wordInterval = 110,
  onComplete,
  instant = false,
}: DialogueSubtitleProps) {
  const words = text.trim().split(/\s+/);
  const [visibleCount, setVisibleCount] = useState(instant ? words.length : 0);
  const [animPhase, setAnimPhase] = useState<AnimPhase>(
    instant ? "hold" : "in",
  );
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setVisibleCount(instant ? words.length : 0);
    setAnimPhase(instant ? "hold" : "in");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, instant]);

  useEffect(() => {
    if (animPhase !== "in") return;
    if (visibleCount >= words.length) {
      const holdId = setTimeout(() => setAnimPhase("out"), 820);
      return () => clearTimeout(holdId);
    }
    const id = setTimeout(() => {
      setVisibleCount((n) => n + 1);
    }, wordInterval);
    return () => clearTimeout(id);
  }, [visibleCount, words.length, wordInterval, animPhase]);

  const handleTransitionEnd = () => {
    if (animPhase === "out") {
      setAnimPhase("done");
      onCompleteRef.current?.();
    }
  };

  if (animPhase === "done") return null;

  return (
    <div
      className="w-full max-w-2xl mx-auto"
      style={{
        opacity: animPhase === "out" ? 0 : 1,
        transition: animPhase === "out" ? "opacity 0.5s ease" : "none",
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="speech-bubble px-6 py-4 animate-bounce-in">
        <p
          className="font-display text-[var(--color-ink)] text-lg leading-snug"
          style={{ letterSpacing: "0.01em", fontWeight: 500 }}
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
                  color: isCurrent
                    ? "var(--color-sunset-deep)"
                    : "var(--color-ink)",
                  transition: visible
                    ? "opacity 0.12s ease, color 0.5s ease"
                    : "none",
                }}
              >
                {word}
              </span>
            );
          })}
        </p>
      </div>
    </div>
  );
}
