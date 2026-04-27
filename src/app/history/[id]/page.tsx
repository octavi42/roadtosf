import Link from "next/link";
import { notFound } from "next/navigation";
import { ENDING_COPY, isEndingKey } from "@/lib/ending-copy";
import { readSessionEmail } from "@/lib/auth";
import { getPlaythroughByIdAndEmail } from "@/lib/playthroughs";
import HistoryReplayActions from "./HistoryReplayActions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function HistoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const email = await readSessionEmail();
  if (!email) {
    // No UUID echo back to logged-out viewers — don't confirm whether the ID
    // points at a real run.
    return <NotLoggedIn />;
  }

  const item = await getPlaythroughByIdAndEmail(id, email);
  if (!item) notFound();

  const endingKey = item.ending && isEndingKey(item.ending) ? item.ending : null;
  const copy = endingKey ? ENDING_COPY[endingKey] : null;

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

      <div className="relative z-10 max-w-md mx-auto px-5 pt-6 pb-16 flex flex-col items-center gap-6">
        <header className="w-full flex items-center justify-between">
          <Link
            href="/history"
            className="comic-outline-sm font-sans font-semibold rounded-md px-3 py-1.5 text-[11px] uppercase tracking-[0.18em]"
            style={{
              background: "var(--color-fog-soft)",
              color: "var(--color-ink)",
            }}
          >
            ← All flights
          </Link>
          <Link
            href="/"
            className="comic-outline-sm font-display uppercase font-bold inline-block"
            style={{
              background: "var(--color-cable)",
              color: "var(--color-fog)",
              padding: "0.35rem 0.85rem",
              borderRadius: "0.5rem",
              fontSize: "0.78rem",
              letterSpacing: "0.18em",
            }}
          >
            Road to SF
          </Link>
        </header>

        <div
          className="comic-outline rounded-2xl p-8 w-full text-center flex flex-col gap-5"
          style={{ background: "var(--color-fog)" }}
        >
          <p
            className="font-display uppercase font-bold inline-block self-center comic-outline-sm rounded-md px-3 py-1"
            style={{
              background: "var(--color-mustard)",
              color: "var(--color-ink)",
              fontSize: "0.78rem",
              letterSpacing: "0.18em",
            }}
          >
            {item.startup_name?.trim() || "Earlier flight"}
          </p>
          <h1
            className="comic-outline font-sans text-3xl font-bold rounded-xl py-4 px-3"
            style={{
              background: copy?.bg ?? "var(--color-fog-soft)",
              color: "var(--color-ink)",
              letterSpacing: "-0.01em",
            }}
          >
            {copy?.label ?? item.ending ?? "UNKNOWN"}
          </h1>
          <p
            className="font-sans text-sm leading-relaxed"
            style={{ color: "rgba(32,32,31,0.8)" }}
          >
            {item.epilogue ?? copy?.subtitle ?? ""}
          </p>
          <div
            className="font-pixel pt-4 flex flex-col gap-1 text-base"
            style={{
              borderTop: "2px dashed var(--color-ink)",
              color: "rgba(32,32,31,0.6)",
            }}
          >
            <span>{formatDate(item.completed_at)}</span>
            {item.achievements.length > 0 && (
              <span>
                {item.achievements.length} achievement
                {item.achievements.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <HistoryReplayActions
            startupName={item.startup_name}
            endingLabel={copy?.label ?? item.ending ?? "UNKNOWN"}
            epilogue={item.epilogue ?? copy?.subtitle ?? ""}
          />
        </div>
      </div>
    </div>
  );
}

function NotLoggedIn() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-5"
      style={{ background: "var(--color-fog)" }}
    >
      <div
        className="comic-outline rounded-2xl p-6 max-w-md w-full text-center"
        style={{ background: "var(--color-fog)" }}
      >
        <p
          className="text-[10px] font-bold tracking-[0.28em] uppercase mb-2"
          style={{ color: "var(--color-bay)" }}
        >
          Earlier flights
        </p>
        <p className="text-sm mb-4" style={{ color: "var(--color-ink)" }}>
          Log in to view past playthroughs.
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
    </div>
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
