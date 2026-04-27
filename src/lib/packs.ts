// Pricing per BUSINESS.md. Lives in its own module so client components can
// import it without dragging in the server-only `stripe` SDK.

export type PackId = "normal" | "business";

export interface Pack {
  id: PackId;
  label: string;
  cabin: string;
  priceCents: number;
  plays: number;
}

export const PACKS: Record<PackId, Pack> = {
  normal: {
    id: "normal",
    label: "One-Way Ticket",
    cabin: "Economy",
    priceCents: 500,
    plays: 3,
  },
  business: {
    id: "business",
    label: "Founder Pass",
    cabin: "Business",
    priceCents: 1500,
    plays: 10,
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
