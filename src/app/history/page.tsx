"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ENDING_COPY, isEndingKey } from "@/lib/ending-copy";
import type { EndingKey } from "@/lib/types";

interface PlaythroughItem {
  id: string;
  startup_name: string | null;
  ending: string | null;
  epilogue: string | null;
  achievements: string[];
  completed_at: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "unauth" }
  | { kind: "ready"; items: PlaythroughItem[] }
  | { kind: "error"; message: string };

export default function HistoryPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [email, setEmail] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const meR = await fetch("/api/auth/me", { cache: "no-store" });
      const me = (await meR.json()) as { email?: string | null };
      if (!me.email) {
        setState({ kind: "unauth" });
        return;
      }
      setEmail(me.email);

      const r = await fetch("/api/playthroughs", { cache: "no-store" });
      const data = (await r.json()) as {
        items?: PlaythroughItem[];
        error?: string;
      };
      if (!r.ok) {
        setState({ kind: "error", message: data.error ?? "Could not load." });
        return;
      }
      setState({ kind: "ready", items: data.items ?? [] });
    } catch (err) {
      console.error("history load failed", err);
      setState({ kind: "error", message: "Network error." });
    }
  }, []);

  useEffect(() => {
    // setState happens after the async fetch resolves, not in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("logout failed", err);
    }
    router.push("/");
  }, [loggingOut, router]);

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{ background: "var(--color-fog)" }}
    >
      <div
        className="absolute inset-0 paper-grain pointer-events-none"
        style={{ opacity: 0.5 }}
      />
      <div
        className="absolute inset-0 halftone pointer-events-none"
        style={{ opacity: 0.18, mixBlendMode: "multiply" }}
      />

      <div className="relative z-10 max-w-2xl mx-auto px-5 pt-6 pb-16">
        <header className="flex items-center justify-between mb-8">
          <Link
            href="/"
            className="comic-outline-sm font-display uppercase font-bold inline-block"
            style={{
              background: "var(--color-cable)",
              color: "var(--color-fog)",
              padding: "0.35rem 0.85rem",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
              letterSpacing: "0.18em",
            }}
          >
            Road to SF
          </Link>
          {email && (
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="comic-outline-sm font-sans font-semibold rounded-md px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] disabled:opacity-50"
              style={{
                background: "var(--color-fog-soft)",
                color: "var(--color-ink)",
              }}
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          )}
        </header>

        <div className="mb-6">
          <p
            className="text-[10px] font-bold tracking-[0.28em] uppercase mb-1"
            style={{ color: "var(--color-bay)" }}
          >
            Earlier flights
          </p>
          <h1
            className="font-sans text-2xl font-bold"
            style={{ color: "var(--color-ink)", letterSpacing: "-0.01em" }}
          >
            Your past playthroughs
          </h1>
          {email && (
            <p
              className="text-[12px] mt-1"
              style={{ color: "rgba(32,32,31,0.55)" }}
            >
              Logged in as{" "}
              <span style={{ color: "var(--color-ink)" }}>{email}</span>
            </p>
          )}
        </div>

        {state.kind === "loading" && (
          <p
            className="text-sm"
            style={{ color: "rgba(32,32,31,0.55)" }}
          >
            Cross-checking the manifest…
          </p>
        )}

        {state.kind === "unauth" && (
          <div
            className="comic-outline rounded-2xl p-6 text-center"
            style={{ background: "var(--color-fog)" }}
          >
            <p className="text-sm mb-4" style={{ color: "var(--color-ink)" }}>
              You&apos;re not logged in.
            </p>
            <Link
              href="/"
              className="comic-outline comic-press inline-block rounded-xl py-2.5 px-5 text-sm font-bold uppercase tracking-[0.18em]"
              style={{
                background: "var(--color-mustard)",
                color: "var(--color-ink)",
              }}
            >
              Go to landing →
            </Link>
          </div>
        )}

        {state.kind === "error" && (
          <div
            className="comic-outline rounded-2xl p-6"
            style={{ background: "var(--color-fog)" }}
          >
            <p
              className="text-sm font-bold"
              style={{ color: "var(--color-cable)" }}
            >
              {state.message}
            </p>
          </div>
        )}

        {state.kind === "ready" && state.items.length === 0 && (
          <div
            className="comic-outline rounded-2xl p-6 text-center"
            style={{ background: "var(--color-fog)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-ink)" }}>
              No completed flights yet.
            </p>
            <Link
              href="/"
              className="comic-outline comic-press inline-block mt-4 rounded-xl py-2.5 px-5 text-sm font-bold uppercase tracking-[0.18em]"
              style={{
                background: "var(--color-sunset)",
                color: "var(--color-ink)",
              }}
            >
              Start a new run →
            </Link>
          </div>
        )}

        {state.kind === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {state.items.map((item) => (
              <PlaythroughCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlaythroughCard({ item }: { item: PlaythroughItem }) {
  const endingKey: EndingKey | null =
    item.ending && isEndingKey(item.ending) ? item.ending : null;
  const copy = endingKey ? ENDING_COPY[endingKey] : null;
  const date = formatDate(item.completed_at);

  return (
    <li>
      <Link
        href={`/history/${item.id}`}
        className="comic-outline comic-press block rounded-2xl px-5 py-4 hover:no-underline"
        style={{ background: "var(--color-fog)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p
              className="text-[10px] tracking-[0.22em] uppercase mb-1"
              style={{ color: "rgba(32,32,31,0.55)" }}
            >
              {date}
            </p>
            <p
              className="text-base font-bold truncate"
              style={{ color: "var(--color-ink)" }}
            >
              {item.startup_name?.trim() || "Unnamed startup"}
            </p>
            {item.epilogue && (
              <p
                className="text-[12px] mt-1.5 line-clamp-2"
                style={{ color: "rgba(32,32,31,0.65)" }}
              >
                {item.epilogue}
              </p>
            )}
          </div>
          <span
            className="comic-outline-sm font-display uppercase font-bold inline-block whitespace-nowrap shrink-0"
            style={{
              background: copy?.bg ?? "var(--color-fog-soft)",
              color: "var(--color-ink)",
              padding: "0.25rem 0.6rem",
              borderRadius: "0.4rem",
              fontSize: "0.7rem",
              letterSpacing: "0.16em",
            }}
          >
            {copy?.label ?? item.ending ?? "—"}
          </span>
        </div>
      </Link>
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
