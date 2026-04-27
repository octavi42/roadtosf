"use client";

import { useEffect, useState } from "react";

interface LoginModalProps {
  onClose: () => void;
  onSuccess: (email: string) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = "email" | "code";

export default function LoginModal({ onClose, onSuccess }: LoginModalProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc-to-close while not in the middle of a request.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, submitting]);

  const handleSendCode = async () => {
    if (submitting) return;
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await r.json()) as { sent?: boolean; error?: string };
      if (!r.ok || !data.sent) {
        setError(data.error ?? "Could not send code.");
        return;
      }
      setStep("code");
    } catch (err) {
      console.error("login send-code failed", err);
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (submitting) return;
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: trimmedCode }),
      });
      const data = (await r.json()) as {
        ok?: boolean;
        email?: string;
        error?: string;
      };
      if (!r.ok || !data.ok) {
        setError(data.error ?? "Could not verify code.");
        return;
      }
      onSuccess(data.email ?? email.trim().toLowerCase());
    } catch (err) {
      console.error("login verify-code failed", err);
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto"
      style={{
        background: "rgba(32,32,31,0.55)",
        backdropFilter: "blur(2px)",
      }}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="w-full max-w-sm flex flex-col items-center gap-3 animate-fade-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="text-[10px] font-bold tracking-[0.32em] uppercase"
          style={{ color: "var(--color-fog)" }}
        >
          Returning passenger
        </p>

        <div
          className="comic-outline w-full overflow-hidden"
          style={{
            background: "var(--color-fog)",
            borderRadius: "18px",
            transform: "rotate(-0.4deg)",
          }}
        >
          <div className="paper-grain px-5 py-5">
            <div className="flex items-baseline justify-between mb-4">
              <p
                className="text-[10px] font-bold tracking-[0.28em] uppercase"
                style={{ color: "var(--color-bay)" }}
              >
                Road to SF · Manifest
              </p>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="text-[11px] tracking-wide hover:underline disabled:opacity-50"
                style={{ color: "rgba(32,32,31,0.55)" }}
              >
                Close
              </button>
            </div>

            {step === "email" && (
              <>
                <label
                  className="block text-[10px] tracking-[0.22em] uppercase mb-1.5 font-bold"
                  style={{ color: "rgba(32,32,31,0.6)" }}
                >
                  Email · we&apos;ll text the code
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  className="ticket-input w-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendCode();
                  }}
                />
                {error && (
                  <p
                    className="text-[12px] text-center mt-3 font-bold"
                    style={{ color: "var(--color-cable)" }}
                  >
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={submitting}
                  className={[
                    "comic-outline comic-press w-full mt-4",
                    "rounded-xl py-3 text-base font-bold uppercase tracking-[0.18em]",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                  style={{
                    background: "var(--color-mustard)",
                    color: "var(--color-ink)",
                  }}
                >
                  {submitting ? "Sending…" : "Send code →"}
                </button>
                <p
                  className="text-[10px] text-center mt-3 tracking-[0.18em] uppercase"
                  style={{ color: "rgba(32,32,31,0.5)" }}
                >
                  Only emails with a past run can log in.
                </p>
              </>
            )}

            {step === "code" && (
              <>
                <p
                  className="text-[11px] mb-3"
                  style={{ color: "rgba(32,32,31,0.7)" }}
                >
                  Code sent to{" "}
                  <span
                    className="font-bold"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {email}
                  </span>
                  .
                </p>
                <label
                  className="block text-[10px] tracking-[0.22em] uppercase mb-1.5 font-bold"
                  style={{ color: "rgba(32,32,31,0.6)" }}
                >
                  Confirmation code
                </label>
                <input
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
                  }
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                  className="ticket-input w-full text-center"
                  style={{ letterSpacing: "0.45em", fontSize: "18px" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleVerify();
                  }}
                />
                {error && (
                  <p
                    className="text-[12px] text-center mt-3 font-bold"
                    style={{ color: "var(--color-cable)" }}
                  >
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={submitting || code.length !== 6}
                  className={[
                    "comic-outline comic-press w-full mt-4",
                    "rounded-xl py-3 text-base font-bold uppercase tracking-[0.18em]",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                  style={{
                    background: "var(--color-mint)",
                    color: "var(--color-ink)",
                  }}
                >
                  {submitting ? "Boarding…" : "Verify and log in →"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError(null);
                  }}
                  disabled={submitting}
                  className="text-[11px] mt-3 hover:underline w-full text-center"
                  style={{ color: "rgba(32,32,31,0.55)" }}
                >
                  Use a different email
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
