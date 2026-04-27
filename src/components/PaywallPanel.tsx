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

// Stripe-managed inputs render inside iframes; this matches the ink-on-fog
// palette of the boarding pass so the card fields don't look like an alien
// element pasted on top.
const STRIPE_ELEMENT_STYLE = {
  base: {
    color: "#20201f",
    fontFamily: "monospace, Menlo, Consolas",
    fontSize: "16px",
    fontWeight: "500",
    "::placeholder": { color: "rgba(32,32,31,0.35)" },
    iconColor: "rgba(32,32,31,0.55)",
  },
  invalid: { color: "#b8273a", iconColor: "#b8273a" },
};

export default function PaywallPanel({ onSatisfied }: PaywallPanelProps) {
  const stripePromise = useMemo(() => getStripePromise(), []);

  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <PaywallShell>
        <p
          className="text-center py-6 text-base"
          style={{ color: "var(--color-cable)" }}
        >
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
  const startupName = useSessionStore((s) => s.intro.startupName);

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

  const [returningUser, setReturningUser] = useState<boolean | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const returningUserRef = useRef<boolean | null>(null);
  const checkInFlightRef = useRef<Promise<void> | null>(null);

  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);

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

    if (checkInFlightRef.current) {
      await checkInFlightRef.current;
    }
    if (returningUserRef.current === true) {
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
    returningUser === null;

  // Boarding-pass top half — flight info, always visible.
  const passengerName = startupName ? `Founder · ${startupName}` : "Founder";

  return (
    <PaywallShell>
      {/* Top half — flight stub */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-baseline justify-between mb-3">
          <p
            className="text-[10px] font-bold tracking-[0.28em] uppercase"
            style={{ color: "var(--color-bay)" }}
          >
            Road to SF · Airways
          </p>
          <p
            className="text-[9px] font-bold tracking-[0.22em] uppercase"
            style={{ color: "var(--color-cable)" }}
          >
            Test mode
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <p
              className="text-[9px] tracking-[0.24em] uppercase mb-0.5"
              style={{ color: "rgba(32,32,31,0.55)" }}
            >
              From
            </p>
            <p
              className="text-2xl font-bold leading-none"
              style={{ color: "var(--color-ink)" }}
            >
              ANYWHERE
            </p>
          </div>
          <PlaneIcon />
          <div className="text-right">
            <p
              className="text-[9px] tracking-[0.24em] uppercase mb-0.5"
              style={{ color: "rgba(32,32,31,0.55)" }}
            >
              To
            </p>
            <p
              className="text-2xl font-bold leading-none"
              style={{ color: "var(--color-ink)" }}
            >
              SFO
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4 text-[10px] tracking-[0.18em] uppercase">
          <StubField label="Flight" value="RTSF · 001" />
          <StubField label="Gate" value="A04" />
          <StubField label="Fare" value={`$${PRICE_USD}`} highlight />
        </div>

        <p
          className="mt-3 text-[10px] tracking-[0.18em] uppercase"
          style={{ color: "rgba(32,32,31,0.6)" }}
        >
          Passenger · <span style={{ color: "var(--color-ink)" }}>{passengerName}</span>
        </p>
      </div>

      {/* Perforation */}
      <Perforation />

      {/* Bottom half — passenger / payment / OTP */}
      <div className="px-5 pt-4 pb-5">
        <div className="mb-3">
          <FieldLabel>Email · receipt</FieldLabel>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
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
            className="ticket-input w-full"
          />
          {checkingEmail && (
            <p
              className="text-[10px] mt-1.5 tracking-wide"
              style={{ color: "rgba(32,32,31,0.55)" }}
            >
              Cross-checking the manifest…
            </p>
          )}
          {returningUser === true && (
            <p
              className="text-[11px] mt-1.5 font-bold"
              style={{ color: "var(--color-bay)" }}
            >
              ★ Frequent flyer found. Skip the line.
            </p>
          )}
        </div>

        {!returningUser && (
          <>
            <div className="mb-3">
              <FieldLabel>Card</FieldLabel>
              <div className="ticket-stripe-wrap relative">
                <CardNumberElement
                  options={{
                    style: STRIPE_ELEMENT_STYLE,
                    placeholder: "1234 1234 1234 1234",
                    showIcon: false,
                  }}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <CardBadge label="VISA" />
                  <CardBadge label="MC" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="ticket-stripe-wrap">
                  <CardExpiryElement
                    options={{
                      style: STRIPE_ELEMENT_STYLE,
                      placeholder: "MM / YY",
                    }}
                  />
                </div>
                <div className="ticket-stripe-wrap">
                  <CardCvcElement
                    options={{
                      style: STRIPE_ELEMENT_STYLE,
                      placeholder: "CVC",
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="mb-4">
              <FieldLabel>Billing</FieldLabel>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="ticket-input appearance-none"
                >
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                </select>
                <input
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="ZIP"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  className="ticket-input w-24"
                />
              </div>
            </div>
          </>
        )}

        {error && (
          <p
            className="text-[12px] text-center mb-3 font-bold"
            style={{ color: "var(--color-cable)" }}
          >
            {error}
          </p>
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
            data-pressed={submitting}
            className={[
              "comic-outline comic-press w-full",
              "rounded-xl py-3 text-base font-bold uppercase tracking-[0.18em]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            ].join(" ")}
            style={{
              background: "var(--color-cable)",
              color: "var(--color-fog)",
            }}
          >
            {submitting ? "Boarding…" : `Board the flight · $${PRICE_USD}`}
          </button>
        )}

        <p
          className="text-[10px] text-center mt-3 tracking-[0.18em] uppercase"
          style={{ color: "rgba(32,32,31,0.5)" }}
        >
          Stripe test · 4242 4242 4242 4242
        </p>
      </div>

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
        className={[
          "comic-outline comic-press w-full",
          "rounded-xl py-3 text-base font-bold uppercase tracking-[0.18em]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
        style={{
          background: "var(--color-mustard)",
          color: "var(--color-ink)",
        }}
      >
        {sendingCode ? "Sending…" : "Send confirmation code →"}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Confirmation code</FieldLabel>
      <input
        value={code}
        onChange={(e) =>
          onCodeChange(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
        }
        placeholder="123456"
        inputMode="numeric"
        maxLength={6}
        autoComplete="one-time-code"
        className="ticket-input w-full text-center"
        style={{ letterSpacing: "0.45em", fontSize: "18px" }}
      />
      <button
        type="button"
        onClick={onVerify}
        disabled={submitting || !canSubmit || code.length !== 6}
        className={[
          "comic-outline comic-press w-full mt-1",
          "rounded-xl py-3 text-base font-bold uppercase tracking-[0.18em]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
        style={{
          background: "var(--color-mint)",
          color: "var(--color-ink)",
        }}
      >
        {submitting ? "Boarding…" : "Verify and board →"}
      </button>
      <button
        type="button"
        onClick={onSendCode}
        disabled={sendingCode}
        className="text-[11px] mt-1 hover:underline"
        style={{ color: "rgba(32,32,31,0.55)" }}
      >
        {sendingCode ? "Resending…" : "Resend code"}
      </button>
    </div>
  );
}

function PaywallShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto"
      style={{ background: "rgba(32,32,31,0.55)", backdropFilter: "blur(2px)" }}
    >
      <div className="w-full max-w-md animate-fade-slide-up flex flex-col items-center gap-4">
        <p
          className="text-[10px] font-bold tracking-[0.32em] uppercase"
          style={{ color: "var(--color-fog)" }}
        >
          Your flight to SFO departs now
        </p>

        <div
          className="comic-outline w-full overflow-hidden"
          style={{
            background: "var(--color-fog)",
            borderRadius: "18px",
            transform: "rotate(-0.4deg)",
          }}
        >
          <div className="paper-grain">{children}</div>
        </div>
      </div>
    </div>
  );
}

function StubField({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p
        className="tracking-[0.18em] uppercase mb-0.5"
        style={{ color: "rgba(32,32,31,0.55)" }}
      >
        {label}
      </p>
      <p
        className="text-base font-bold tracking-wide"
        style={{
          color: highlight ? "var(--color-cable)" : "var(--color-ink)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="block text-[10px] tracking-[0.22em] uppercase mb-1.5 font-bold"
      style={{ color: "rgba(32,32,31,0.6)" }}
    >
      {children}
    </label>
  );
}

function Perforation() {
  return (
    <div className="relative h-4">
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2"
        style={{
          borderTopStyle: "dashed",
          borderColor: "rgba(32,32,31,0.45)",
        }}
      />
      <div
        className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full"
        style={{ background: "rgba(32,32,31,0.55)" }}
      />
      <div
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full"
        style={{ background: "rgba(32,32,31,0.55)" }}
      />
    </div>
  );
}

function CardBadge({ label }: { label: string }) {
  return (
    <span
      className="text-[8px] font-bold tracking-[0.15em] px-1.5 py-0.5 rounded border-2"
      style={{
        borderColor: "var(--color-ink)",
        color: "var(--color-ink)",
        background: "var(--color-fog-soft)",
      }}
    >
      {label}
    </span>
  );
}

function PlaneIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ marginBottom: 2 }}
    >
      <path d="M2 12h20" />
      <path d="M14 5l5 7-5 7" />
      <path d="M9 5l-2 7 2 7" />
    </svg>
  );
}
