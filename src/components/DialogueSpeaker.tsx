"use client";

import { useEffect, useRef, useState } from "react";

export interface DialogueSpeakerProps {
  speaker?: string;
  fadeMs?: number;
}

/**
 * Comic-style nameplate. Persists across same-speaker lines and
 * fades when the speaker changes.
 */
export default function DialogueSpeaker({
  speaker,
  fadeMs = 350,
}: DialogueSpeakerProps) {
  const [displayed, setDisplayed] = useState(speaker);
  const [visible, setVisible] = useState(Boolean(speaker));
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (speaker === displayed) return;

    if (swapTimer.current) clearTimeout(swapTimer.current);
    setVisible(false);
    swapTimer.current = setTimeout(() => {
      setDisplayed(speaker);
      setVisible(Boolean(speaker));
    }, fadeMs);

    return () => {
      if (swapTimer.current) clearTimeout(swapTimer.current);
    };
  }, [speaker, displayed, fadeMs]);

  return (
    <div
      className="mb-2 ml-4"
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${fadeMs}ms ease`,
        minHeight: "1.5em",
      }}
    >
      {displayed && (
        <span
          className="comic-outline-sm inline-block px-3 py-1 rounded-md font-display uppercase comic-tilt-l"
          style={{
            background: "var(--color-mustard)",
            color: "var(--color-ink)",
            fontSize: "0.78rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
          }}
        >
          {displayed}
        </span>
      )}
    </div>
  );
}
