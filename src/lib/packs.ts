// Pricing per BUSINESS.md. Lives in its own module so client components can
// import it without dragging in the server-only `stripe` SDK.
//
// 1 credit = 1 LLM-generated scene. The engine debits one credit on
// the first beat of each scene; subsequent beats within the same scene
// are free. Episodes run 3–5 scenes; /api/generate-episode refuses to
// start an episode unless the balance >= EPISODE_FLOOR (5), so the
// player never gets stranded mid-narrative — paywall fires between
// episodes only. Two-SKU shape per BUSINESS.md.

export type PackId = "normal" | "business";

export interface Pack {
  id: PackId;
  label: string;
  cabin: string;
  priceCents: number;
  credits: number;
}

export const PACKS: Record<PackId, Pack> = {
  normal: {
    id: "normal",
    label: "One-Way Ticket",
    cabin: "Economy",
    priceCents: 500,
    // 6 scenes — covers a worst-case 5-scene episode with 1 left
    // over. The leftover can't start a new episode (EPISODE_FLOOR=5),
    // so the player gets exactly 1 guaranteed full episode per pack.
    credits: 6,
  },
  business: {
    id: "business",
    label: "Founder Pass",
    cabin: "Business",
    priceCents: 1500,
    // 20 scenes — exactly 4 guaranteed full episodes (4 × 5 worst
    // case). Shorter episodes leave dead credits the player can't
    // spend; that's deliberate — the SKU is "4 episodes," not "20
    // arbitrary scenes."
    credits: 20,
  },
};

export function getPack(id: unknown): Pack | null {
  if (typeof id !== "string") return null;
  return PACKS[id as PackId] ?? null;
}

export function formatUsd(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}
