"use client";

import { useEffect, useRef, useState } from "react";

export interface DialogueSubtitleProps {
  text: string;
  speaker?: string;
  wordInterval?: number;
  onComplete?: () => void;
  instant?: boolean;
}

type AnimPhase = "in" | "hold" | "out" | "done";

export default function DialogueSubtitle({
  text,
  speaker,
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

  // Reset when text changes
  useEffect(() => {
    setVisibleCount(instant ? words.length : 0);
    setAnimPhase(instant ? "hold" : "in");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, instant]);

  // Tick words in one at a time while in "in" phase
  useEffect(() => {
    if (animPhase !== "in") return;
    if (visibleCount >= words.length) {
      // All words visible — hold briefly then fade out
      const holdId = setTimeout(() => setAnimPhase("out"), 820);
      return () => clearTimeout(holdId);
    }
    const id = setTimeout(() => {
      setVisibleCount((n) => n + 1);
    }, wordInterval);
    return () => clearTimeout(id);
  }, [visibleCount, words.length, wordInterval, animPhase]);

  // When fade-out transition ends, mark done and fire onComplete
  const handleTransitionEnd = () => {
    if (animPhase === "out") {
      setAnimPhase("done");
      onCompleteRef.current?.();
    }
  };

  if (animPhase === "done") return null;

  return (
    <div
      className="w-full max-w-2xl mx-auto px-2 select-none"
      style={{
        opacity: animPhase === "out" ? 0 : 1,
        transition: animPhase === "out" ? "opacity 0.5s ease" : "none",
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* Speaker label */}
      {speaker && (
        <p
          className="text-white/40 text-xs uppercase font-medium mb-2"
          style={{ letterSpacing: "0.18em" }}
        >
          {speaker}
        </p>
      )}

      {/* Subtitle line */}
      <p
        className="text-white text-lg leading-snug font-normal"
        style={{
          textShadow: "0 2px 12px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)",
        }}
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
