"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { useSessionStore } from "@/lib/session";

interface PaywallPanelProps {
  onSatisfied: () => void;
}

const PRICE_USD = "4.99";

// loadStripe is module-scoped so the Stripe object isn't recreated per render.
const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

let stripePromiseCache: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> {
  if (stripePromiseCache) return stripePromiseCache;
  stripePromiseCache = STRIPE_PUBLISHABLE_KEY
    ? loadStripe(STRIPE_PUBLISHABLE_KEY)
    : Promise.resolve(null);
  return stripePromiseCache;
}

type Status =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "error"; message: string };

export default function PaywallPanel({ onSatisfied }: PaywallPanelProps) {
  const playthroughId = useSessionStore((s) => s.playthroughId);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // sessionId is captured from the checkout response and consumed by the
  // verify call after Stripe fires onComplete.
  const sessionIdRef = useRef<string | null>(null);

  const stripePromise = useMemo(() => getStripePromise(), []);

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    if (!playthroughId) throw new Error("missing playthroughId");
    const res = await fetch("/api/paywall/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playthroughId }),
    });
    const data = (await res.json()) as {
      clientSecret?: string;
      sessionId?: string;
      error?: string;
    };
    if (!res.ok || !data.clientSecret || !data.sessionId) {
      throw new Error(data.error ?? "checkout failed");
    }
    sessionIdRef.current = data.sessionId;
    return data.clientSecret;
  }, [playthroughId]);

  const handleComplete = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setStatus({ kind: "error", message: "Missing session id." });
      return;
    }
    setStatus({ kind: "verifying" });
    try {
      const res = await fetch("/api/paywall/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as { paid?: boolean; error?: string };
      if (!res.ok || !data.paid) {
        setStatus({
          kind: "error",
          message: data.error ?? "Payment could not be verified.",
        });
        return;
      }
      onSatisfied();
    } catch (err) {
      console.error("paywall verify failed", err);
      setStatus({ kind: "error", message: "Network error during verify." });
    }
  }, [onSatisfied]);

  // EmbeddedCheckoutProvider's stripe + options must be stable references —
  // re-rendering with a new options object remounts the iframe.
  const options = useMemo(
    () => ({ fetchClientSecret, onComplete: handleComplete }),
    [fetchClientSecret, handleComplete],
  );

  const configError = !STRIPE_PUBLISHABLE_KEY
    ? "Stripe publishable key not configured."
    : !playthroughId
      ? "Missing playthrough id. Refresh and start over."
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/65 backdrop-blur-sm overflow-y-auto">
      <div className="flex flex-col items-center gap-4 w-full max-w-md animate-fade-slide-up">
        <p className="text-white/40 text-[11px] font-medium tracking-[0.28em] uppercase">
          Word travels fast in SF
        </p>

        <div className="backdrop-panel rounded-2xl p-6 w-full">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-amber-400 text-xs font-semibold tracking-widest uppercase">
              Capital for the trip
            </p>
            <span className="text-white/40 text-[10px] tracking-wider uppercase">
              Test mode
            </span>
          </div>
          <h2 className="text-white text-xl font-semibold mb-1">
            ${PRICE_USD} once. Rest of the trip on us.
          </h2>
          <p className="text-white/45 text-sm mb-5">
            One charge unlocks the next two acts.
          </p>

          {configError ? (
            <PaywallStatus tone="error">{configError}</PaywallStatus>
          ) : (
            <div className="rounded-lg overflow-hidden bg-white">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={options}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          )}

          {status.kind === "verifying" && (
            <PaywallStatus tone="muted">Verifying payment…</PaywallStatus>
          )}
          {status.kind === "error" && (
            <PaywallStatus tone="error">{status.message}</PaywallStatus>
          )}

          <p className="text-white/30 text-[10px] text-center mt-4 tracking-wide">
            Stripe test mode — use 4242 4242 4242 4242
          </p>
        </div>
      </div>
    </div>
  );
}

function PaywallStatus({
  tone,
  children,
}: {
  tone: "muted" | "error";
  children: React.ReactNode;
}) {
  const color = tone === "error" ? "text-red-300" : "text-white/55";
  return <p className={`text-sm ${color} text-center py-4`}>{children}</p>;
}
