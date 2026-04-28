import { getToneSpec } from "@/lib/cameos/tone";
import type { RolledCameo, ToneId } from "@/lib/cameos/types";

interface EndingFateCardProps {
  rolledCameos?: RolledCameo[];
  tone?: ToneId;
}

// Post-hoc rarity reveal. Kept deliberately minimal: a small section under
// the epilogue that names the cameos this run rolled and their rarity %.
// The number isn't a player-input — it's the cameo's pre-baked tier — so
// the same Sam Altman roll always shows 4% across the population.
export default function EndingFateCard({
  rolledCameos,
  tone,
}: EndingFateCardProps) {
  const cameos = rolledCameos ?? [];
  if (cameos.length === 0 && !tone) return null;
  const toneSpec = tone ? getToneSpec(tone) : undefined;

  return (
    <div
      className="font-pixel flex flex-col gap-2 pt-4"
      style={{ borderTop: "2px dashed var(--color-ink)" }}
    >
      {toneSpec && (
        <div className="flex items-center justify-between text-sm text-[var(--color-ink)]/70">
          <span className="uppercase tracking-[0.18em] text-xs">Run tone</span>
          <span className="font-bold text-[var(--color-ink)]">
            {toneSpec.label}
          </span>
        </div>
      )}
      {cameos.length > 0 && (
        <>
          <span className="uppercase tracking-[0.18em] text-xs text-[var(--color-ink)]/70 text-left">
            Cameos this run
          </span>
          <div className="flex flex-col gap-1">
            {cameos.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-bold text-[var(--color-ink)]">
                  {c.displayName}
                </span>
                <span
                  className="comic-outline-sm rounded-md px-2 py-0.5 text-[11px] font-display uppercase tracking-[0.14em]"
                  style={{
                    background: "var(--color-mustard)",
                    color: "var(--color-ink)",
                  }}
                >
                  {c.rarity}% encounter
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
