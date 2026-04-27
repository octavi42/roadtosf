import type { EndingKey } from "./types";

// Single source of truth for the cosmetic copy + colour of each ending.
// Lives in lib (not in page.tsx) so the /history pages can reuse it without
// pulling the whole game shell in.
export interface EndingCopy {
  label: string;
  subtitle: string;
  bg: string;
}

export const ENDING_COPY: Record<EndingKey, EndingCopy> = {
  ipo: {
    label: "IPO",
    subtitle:
      "You rang the bell at NYSE on a Tuesday. You cried. Maya didn't come. The Bloomberg headline called you 'the unlikely conscience of fintech.' You framed it.",
    bg: "var(--color-mint)",
  },
  indicted: {
    label: "INDICTED",
    subtitle:
      "The SEC opened an inquiry in November. You're on your third podcast apology tour. The company pivoted to compliance software. It still has twelve employees.",
    bg: "var(--color-cable)",
  },
  "ai-wrapper": {
    label: "AI-WRAPPER PIVOT",
    subtitle:
      "You quietly rebranded with an AI suffix, laid off four people, and wrote a Substack post called 'Why We're Going Back to Basics.' It got three thousand likes.",
    bg: "var(--color-karl)",
  },
  acquihire: {
    label: "ACQUI-HIRED",
    subtitle:
      "DraftKings bought the team for parts. You got a director title and a non-compete. Maya took her thirty percent and started something new without you.",
    bg: "var(--color-mustard)",
  },
  ghosted: {
    label: "GHOSTED",
    subtitle:
      "The company never quite registered. The algorithm didn't notice. The co-working space lease expired. You still have the hoodie.",
    bg: "var(--color-fog-soft)",
  },
};

const ENDING_KEYS = new Set<EndingKey>([
  "ipo",
  "indicted",
  "ai-wrapper",
  "acquihire",
  "ghosted",
]);

export function isEndingKey(value: string): value is EndingKey {
  return ENDING_KEYS.has(value as EndingKey);
}
