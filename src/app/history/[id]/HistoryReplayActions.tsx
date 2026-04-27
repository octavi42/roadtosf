"use client";

import { useCallback } from "react";
import Link from "next/link";

interface Props {
  startupName: string | null;
  endingLabel: string;
  epilogue: string;
}

export default function HistoryReplayActions({
  startupName,
  endingLabel,
  epilogue,
}: Props) {
  const handleShareX = useCallback(() => {
    const headline = startupName
      ? `Built ${startupName} in San Francisco. Got: ${endingLabel}.`
      : `San Francisco didn't go as planned. Got: ${endingLabel}.`;
    const text = `${epilogue}\n\n${headline}\nTry yours →`;
    const url = window.location.origin;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      text,
    )}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }, [startupName, endingLabel, epilogue]);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <button
        type="button"
        onClick={handleShareX}
        className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base"
        style={{
          background: "var(--color-sunset)",
          color: "var(--color-ink)",
          letterSpacing: "-0.005em",
        }}
      >
        Share on X
      </button>
      <Link
        href="/"
        className="comic-outline comic-press font-sans font-semibold w-full rounded-xl py-3 text-base text-center"
        style={{
          background: "var(--color-mint)",
          color: "var(--color-ink)",
          letterSpacing: "-0.005em",
        }}
      >
        Play again →
      </Link>
    </div>
  );
}
