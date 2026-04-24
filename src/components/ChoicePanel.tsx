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
    <div className="backdrop-panel rounded-2xl px-6 py-4 w-full max-w-2xl mx-auto animate-fade-slide-up">
      <div className="flex gap-3 justify-center flex-wrap">
        {choices.map((choice) => {
          const isSelected = selected === choice.id;
          return (
            <button
              key={choice.id}
              onClick={() => handleChoice(choice.id)}
              disabled={selected !== null || disabled}
              className={[
                "flex-1 min-w-[140px] max-w-[220px] px-4 py-3 rounded-xl border text-white text-sm font-medium transition-all",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                isSelected
                  ? "border-white/60 bg-white/15 animate-pulse-glow"
                  : "border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/30",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
