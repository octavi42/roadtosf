"use client";

import { useRef, useState } from "react";

interface Choice {
  id: string;
  label: string;
}

interface ChoicePanelProps {
  choices: Choice[];
  onChoice: (id: string) => void;
  disabled?: boolean;
}

const ACCENTS = [
  { bg: "var(--color-mustard)", hover: "#ffd470" },
  { bg: "var(--color-sunset)", hover: "#ffa494" },
  { bg: "var(--color-karl)", hover: "#5fa6ba" },
  { bg: "var(--color-mint)", hover: "#a3e6c4" },
];

export default function ChoicePanel({
  choices,
  onChoice,
  disabled = false,
}: ChoicePanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const hasCalledRef = useRef(false);

  function handleChoice(id: string) {
    if (selected !== null || disabled || hasCalledRef.current) return;
    hasCalledRef.current = true;
    setSelected(id);
    onChoice(id);
  }

  return (
    <div className="w-full max-w-2xl mx-auto animate-bounce-in">
      <div className="flex gap-4 justify-center flex-wrap px-2">
        {choices.map((choice, idx) => {
          const isSelected = selected === choice.id;
          const accent = ACCENTS[idx % ACCENTS.length];
          const tilt = idx % 2 === 0 ? "comic-tilt-l" : "comic-tilt-r";
          return (
            <button
              key={choice.id}
              onClick={() => handleChoice(choice.id)}
              disabled={selected !== null || disabled}
              data-pressed={isSelected}
              className={[
                "comic-outline comic-press flex-1 min-w-[150px] max-w-[230px]",
                "px-4 py-3 rounded-2xl font-display text-[var(--color-ink)]",
                "text-base font-bold uppercase tracking-wide",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                isSelected ? "animate-pulse-glow" : tilt,
              ].join(" ")}
              style={{
                background: isSelected ? "var(--color-sunset)" : accent.bg,
                letterSpacing: "0.04em",
                lineHeight: 1.15,
              }}
              onMouseEnter={(e) => {
                if (!isSelected)
                  e.currentTarget.style.background = accent.hover;
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = accent.bg;
              }}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
