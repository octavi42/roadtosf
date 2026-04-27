// Pricing per BUSINESS.md. Lives in its own module so client components can
// import it without dragging in the server-only `stripe` SDK.
//
// 1 credit = 1 LLM-generated group of 4 sub-scenes (one Sonnet call per
// sub-scene, one shared image, four TTS lines). Cost basis ~$0.42/group.
// Two-SKU shape per BUSINESS.md §"Recommended pricing — UX-optimized".

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
    // 6 credits ≈ 6 groups ≈ ~1 full episode + a head start on the next.
    // COGS ≈ $2.52, Stripe ≈ $0.45, net ≈ $2.03 (40% margin).
    credits: 6,
  },
  business: {
    id: "business",
    label: "Founder Pass",
    cabin: "Business",
    priceCents: 1500,
    // 20 credits ≈ 4 episodes. COGS ≈ $8.40, Stripe ≈ $0.74,
    // net ≈ $5.86 (39% margin).
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
