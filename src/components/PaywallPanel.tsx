"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useSessionStore } from "@/lib/session";

interface PaywallPanelProps {
  onSatisfied: () => void;
}

const PRICE_USD = "4.99";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Stripe-managed inputs render inside iframes; this style config makes the
// rendered text inside those iframes match the surrounding white-on-glass UI.
const STRIPE_ELEMENT_STYLE = {
  base: {
    color: "#ffffff",
    fontFamily: "inherit",
    fontSize: "14px",
    fontWeight: "400",
    "::placeholder": { color: "rgba(255,255,255,0.25)" },
    iconColor: "rgba(255,255,255,0.5)",
  },
  invalid: { color: "#fca5a5", iconColor: "#fca5a5" },
};

export default function PaywallPanel({ onSatisfied }: PaywallPanelProps) {
  const stripePromise = useMemo(() => getStripePromise(), []);

  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <PaywallShell>
        <p className="text-red-300 text-sm text-center py-6">
          Stripe publishable key not configured.
        </p>
      </PaywallShell>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <PaywallForm onSatisfied={onSatisfied} />
    </Elements>
  );
}

function PaywallForm({ onSatisfied }: PaywallPanelProps) {
  const stripe = useStripe();
  const elements = useElements();
  const playthroughId = useSessionStore((s) => s.playthroughId);
  const setPlaythroughId = useSessionStore((s) => s.setPlaythroughId);

  // If we land on the paywall with no playthrough (refresh after dev-jump,
  // or any future state-loss path), backfill a stub row inline so the rest
  // of the flow has something to attach to.
  useEffect(() => {
    if (playthroughId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/playthroughs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            flavorTags: [],
            introTranscript: "[paywall self-heal — no onboarding]",
          }),
        });
        const data = (await r.json()) as { id?: string };
        if (!cancelled && data.id) setPlaythroughId(data.id);
      } catch (err) {
        console.error("paywall self-heal playthrough failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playthroughId, setPlaythroughId]);

  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("US");
  const [zip, setZip] = useState("");

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Returning-user lookup. null = not yet checked, true/false = result for the
  // last fully-typed email. Recomputed on blur so we don't hammer the endpoint
  // on every keystroke.
  const [returningUser, setReturningUser] = useState<boolean | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  // Mirror returningUser in a ref so handleSubmit can read the latest value
  // after awaiting an in-flight check (state from the closure is stale).
  const returningUserRef = useRef<boolean | null>(null);
  // Track an in-flight /check-email call so handleSubmit can await it before
  // charging — closes the race where blur (triggered by the Pay click)
  // starts a check that hasn't resolved yet.
  const checkInFlightRef = useRef<Promise<void> | null>(null);

  // OTP state for the returning-user flow.
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);

  // Fetch a PaymentIntent the moment the panel mounts so the form is ready
  // to submit by the time the player has finished typing.
  useEffect(() => {
    if (!playthroughId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/paywall/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playthroughId }),
        });
        const data = (await res.json()) as {
          clientSecret?: string;
          paymentIntentId?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.clientSecret || !data.paymentIntentId) {
          setError(data.error ?? "Could not start checkout.");
          return;
        }
        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);
      } catch (err) {
        if (cancelled) return;
        console.error("paywall checkout failed", err);
        setError("Network error.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playthroughId]);

  const handleEmailBlur = async () => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      returningUserRef.current = null;
      setReturningUser(null);
      return;
    }
    setCheckingEmail(true);
    const promise = (async () => {
      try {
        const r = await fetch("/api/paywall/check-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
        const data = (await r.json()) as { paid?: boolean };
        const result = Boolean(data.paid);
        returningUserRef.current = result;
        setReturningUser(result);
      } catch (err) {
        console.error("paywall check-email failed", err);
        returningUserRef.current = null;
        setReturningUser(null);
      } finally {
        setCheckingEmail(false);
      }
    })();
    checkInFlightRef.current = promise;
    try {
      await promise;
    } finally {
      if (checkInFlightRef.current === promise) {
        checkInFlightRef.current = null;
      }
    }
  };

  const handleSendCode = async () => {
    if (sendingCode) return;
    if (!EMAIL_RE.test(email.trim())) return;
    setSendingCode(true);
    setError(null);
    try {
      const r = await fetch("/api/paywall/email/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await r.json()) as { sent?: boolean; error?: string };
      if (!r.ok || !data.sent) {
        setError(data.error ?? "Could not send code.");
        setSendingCode(false);
        return;
      }
      setCodeSent(true);
    } catch (err) {
      console.error("paywall send-code failed", err);
      setError("Network error sending code.");
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (submitting) return;
    if (!playthroughId) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/paywall/email/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playthroughId,
          email: email.trim(),
          code: code.trim(),
        }),
      });
      const data = (await r.json()) as { paid?: boolean; error?: string };
      if (!r.ok || !data.paid) {
        setError(data.error ?? "Could not verify code.");
        setSubmitting(false);
        return;
      }
      onSatisfied();
    } catch (err) {
      console.error("paywall verify-code failed", err);
      setError("Network error during verify.");
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!stripe || !elements || !clientSecret || !paymentIntentId) return;
    const cardNumber = elements.getElement(CardNumberElement);
    if (!cardNumber) return;

    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError("Enter your email so we can send you a receipt.");
      return;
    }

    // Settle any in-flight /check-email so a returning user is never charged.
    // If the user clicks Pay before tabbing out, the click event fires the
    // blur handler synchronously; without this await, the charge could run
    // before the lookup resolves.
    if (checkInFlightRef.current) {
      await checkInFlightRef.current;
    }
    if (returningUserRef.current === true) {
      // The returning-user OTP UI should already be on screen.
      return;
    }

    setSubmitting(true);
    setError(null);

    const { paymentIntent, error: stripeError } =
      await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardNumber,
          billing_details: {
            email: email || undefined,
            address: {
              country,
              postal_code: zip || undefined,
            },
          },
        },
      });

    if (stripeError) {
      setError(stripeError.message ?? "Payment failed.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status !== "succeeded") {
      setError(`Unexpected status: ${paymentIntent?.status ?? "unknown"}.`);
      setSubmitting(false);
      return;
    }

    // Server-side verification — the trust gate. Don't flip session state
    // until the server confirms with Stripe directly.
    try {
      const r = await fetch("/api/paywall/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentIntentId,
          email: EMAIL_RE.test(email.trim()) ? email.trim() : undefined,
        }),
      });
      const data = (await r.json()) as { paid?: boolean; error?: string };
      if (!r.ok || !data.paid) {
        setError(data.error ?? "Payment could not be verified.");
        setSubmitting(false);
        return;
      }
      onSatisfied();
    } catch (err) {
      console.error("paywall verify failed", err);
      setError("Network error during verify.");
      setSubmitting(false);
    }
  };

  const stripeReady = stripe && elements && clientSecret;
  const emailValid = EMAIL_RE.test(email.trim());
  const buttonDisabled =
    !stripeReady ||
    submitting ||
    checkingEmail ||
    !emailValid ||
    // Wait for /check-email to confirm yes/no before allowing a charge —
    // prevents the double-charge race if the user clicks Pay before blur
    // resolves.
    returningUser === null;

  return (
    <PaywallShell>
      <div className="mb-3">
        <label className="block text-white/55 text-[11px] uppercase tracking-wider mb-1">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            // Invalidate any prior lookup as soon as the email changes —
            // we'll re-check on blur once they stop typing.
            if (returningUser !== null) setReturningUser(null);
            returningUserRef.current = null;
            if (codeSent) {
              setCodeSent(false);
              setCode("");
            }
          }}
          onBlur={handleEmailBlur}
          placeholder="you@example.com"
          autoComplete="email"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors"
        />
        {checkingEmail && (
          <p className="text-white/40 text-[10px] mt-1.5">Checking…</p>
        )}
        {returningUser === true && (
          <p className="text-emerald-300 text-[11px] mt-1.5">
            Welcome back. We found a previous payment for this email.
          </p>
        )}
      </div>

      <div className={`mb-3 ${returningUser ? "hidden" : ""}`}>
        <label className="block text-white/55 text-[11px] uppercase tracking-wider mb-1">
          Card information
        </label>
        <div className="relative">
          <div className="w-full bg-white/5 border border-white/10 rounded-t-lg px-3.5 py-3 pr-20 focus-within:border-white/30 transition-colors">
            <CardNumberElement
              options={{
                style: STRIPE_ELEMENT_STYLE,
                placeholder: "1234 1234 1234 1234",
                showIcon: false,
              }}
            />
          </div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <CardBadge label="VISA" />
            <CardBadge label="MC" />
            <CardBadge label="AMEX" muted />
          </div>
        </div>
        <div className="flex">
          <div className="flex-1 bg-white/5 border border-white/10 border-t-0 rounded-bl-lg px-3.5 py-3 focus-within:border-white/30 transition-colors">
            <CardExpiryElement
              options={{
                style: STRIPE_ELEMENT_STYLE,
                placeholder: "MM / YY",
              }}
            />
          </div>
          <div className="flex-1 bg-white/5 border border-white/10 border-t-0 border-l-0 rounded-br-lg px-3.5 py-3 focus-within:border-white/30 transition-colors">
            <CardCvcElement
              options={{
                style: STRIPE_ELEMENT_STYLE,
                placeholder: "CVC",
              }}
            />
          </div>
        </div>
      </div>

      <div className={`mb-5 ${returningUser ? "hidden" : ""}`}>
        <label className="block text-white/55 text-[11px] uppercase tracking-wider mb-1">
          Billing address
        </label>
        <div className="flex">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
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

      {error && (
        <p className="text-red-300 text-xs text-center mb-3">{error}</p>
      )}

      {returningUser ? (
        <ReturningUserPanel
          codeSent={codeSent}
          code={code}
          onCodeChange={setCode}
          sendingCode={sendingCode}
          submitting={submitting}
          onSendCode={handleSendCode}
          onVerify={handleVerifyCode}
          canSubmit={Boolean(playthroughId)}
        />
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={buttonDisabled}
          className="w-full bg-white text-black font-semibold rounded-lg py-3 hover:bg-white/90 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <LockIcon />
          {submitting ? "Processing…" : `Pay $${PRICE_USD}`}
        </button>
      )}

      <p className="text-white/30 text-[10px] text-center mt-4 tracking-wide">
        Stripe test mode — use 4242 4242 4242 4242
      </p>
    </PaywallShell>
  );
}

function ReturningUserPanel({
  codeSent,
  code,
  onCodeChange,
  sendingCode,
  submitting,
  onSendCode,
  onVerify,
  canSubmit,
}: {
  codeSent: boolean;
  code: string;
  onCodeChange: (v: string) => void;
  sendingCode: boolean;
  submitting: boolean;
  onSendCode: () => void;
  onVerify: () => void;
  canSubmit: boolean;
}) {
  if (!codeSent) {
    return (
      <button
        type="button"
        onClick={onSendCode}
        disabled={sendingCode || !canSubmit}
        className="w-full bg-emerald-400 text-black font-semibold rounded-lg py-3 hover:bg-emerald-300 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sendingCode ? "Sending…" : "Send code to email →"}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="block text-white/55 text-[11px] uppercase tracking-wider">
        Enter the 6-digit code
      </label>
      <input
        value={code}
        onChange={(e) =>
          onCodeChange(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
        }
        placeholder="123456"
        inputMode="numeric"
        maxLength={6}
        autoComplete="one-time-code"
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-white text-base tracking-[0.4em] text-center placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors"
      />
      <button
        type="button"
        onClick={onVerify}
        disabled={submitting || !canSubmit || code.length !== 6}
        className="w-full bg-emerald-400 text-black font-semibold rounded-lg py-3 hover:bg-emerald-300 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Verifying…" : "Verify and continue →"}
      </button>
      <button
        type="button"
        onClick={onSendCode}
        disabled={sendingCode}
        className="text-white/40 text-[11px] hover:text-white/70 transition-colors mt-1"
      >
        {sendingCode ? "Resending…" : "Resend code"}
      </button>
    </div>
  );
}

function PaywallShell({ children }: { children: React.ReactNode }) {
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

          {children}
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
