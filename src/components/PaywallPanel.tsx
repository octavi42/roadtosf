"use client";

import { useState } from "react";

interface PaywallPanelProps {
  onSatisfied: () => void;
}

const PRICE_USD = "4.99";

export default function PaywallPanel({ onSatisfied }: PaywallPanelProps) {
  // Local-only state so the form is typeable. No validation, no submission yet —
  // when Stripe is wired this whole panel becomes <EmbeddedCheckout>.
  const [email, setEmail] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [zip, setZip] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/65 backdrop-blur-sm overflow-y-auto">
      <div className="flex flex-col items-center gap-4 w-full max-w-md animate-fade-slide-up">
        <p className="text-white/40 text-[11px] font-medium tracking-[0.28em] uppercase">
          Word travels fast in SF
        </p>

        <div className="backdrop-panel rounded-2xl p-6 w-full">
          {/* Header */}
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

          {/* Email */}
          <div className="mb-3">
            <label className="block text-white/55 text-[11px] uppercase tracking-wider mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>

          {/* Card number */}
          <div className="mb-3">
            <label className="block text-white/55 text-[11px] uppercase tracking-wider mb-1">
              Card information
            </label>
            <div className="relative">
              <input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="1234 1234 1234 1234"
                inputMode="numeric"
                autoComplete="cc-number"
                className="w-full bg-white/5 border border-white/10 rounded-t-lg px-3.5 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors pr-20"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <CardBadge label="VISA" />
                <CardBadge label="MC" />
                <CardBadge label="AMEX" muted />
              </div>
            </div>
            <div className="flex">
              <input
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                placeholder="MM / YY"
                inputMode="numeric"
                autoComplete="cc-exp"
                className="flex-1 bg-white/5 border border-white/10 border-t-0 rounded-bl-lg px-3.5 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors"
              />
              <input
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
                placeholder="CVC"
                inputMode="numeric"
                autoComplete="cc-csc"
                className="flex-1 bg-white/5 border border-white/10 border-t-0 border-l-0 rounded-br-lg px-3.5 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
          </div>

          {/* Country + ZIP */}
          <div className="mb-5">
            <label className="block text-white/55 text-[11px] uppercase tracking-wider mb-1">
              Billing address
            </label>
            <div className="flex">
              <select
                defaultValue="US"
                className="flex-1 bg-white/5 border border-white/10 rounded-l-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-white/30 transition-colors appearance-none"
              >
                <option value="US" className="bg-black">
                  United States
                </option>
                <option value="CA" className="bg-black">
                  Canada
                </option>
                <option value="GB" className="bg-black">
                  United Kingdom
                </option>
              </select>
              <input
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="ZIP"
                inputMode="numeric"
                autoComplete="postal-code"
                className="w-28 bg-white/5 border border-white/10 border-l-0 rounded-r-lg px-3.5 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
          </div>

          {/* Pay */}
          <button
            type="button"
            onClick={() => onSatisfied()}
            className="w-full bg-white text-black font-semibold rounded-lg py-3 hover:bg-white/90 transition-colors text-sm flex items-center justify-center gap-2"
          >
            <LockIcon />
            Pay ${PRICE_USD}
          </button>

          {/* Footer */}
          <p className="text-white/30 text-[10px] text-center mt-4 tracking-wide">
            Prototype — no real charge
          </p>
        </div>
      </div>
    </div>
  );
}

function CardBadge({
  label,
  muted = false,
}: {
  label: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${
        muted
          ? "border-white/10 text-white/25"
          : "border-white/30 text-white/70"
      }`}
    >
      {label}
    </span>
  );
}

function LockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
