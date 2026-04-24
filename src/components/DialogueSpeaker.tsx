"use client";

import { useEffect, useRef, useState } from "react";

export interface DialogueSpeakerProps {
  speaker?: string;
  fadeMs?: number;
}

/**
 * Renders a speaker label that persists across same-speaker dialogue lines
 * and fades out → swaps → fades in only when the speaker actually changes.
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
    <p
      className="text-white/40 text-xs uppercase font-medium mb-2"
      style={{
        letterSpacing: "0.18em",
        opacity: visible ? 1 : 0,
        transition: `opacity ${fadeMs}ms ease`,
        minHeight: "1em",
      }}
    >
      {displayed ?? " "}
    </p>
  );
}
