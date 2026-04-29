"use client";

import { useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";

import { ARCHETYPES } from "@/lib/archetypes";
import { ARCHETYPE_KEYS } from "@/lib/agents";
import type { Archetype } from "@/lib/types";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";

export default function VoiceTestPage() {
  return (
    <ConversationProvider>
      <VoiceTest />
    </ConversationProvider>
  );
}

function VoiceTest() {
  const [archetype, setArchetype] = useState<Archetype>("cofounder");
  const [startupName, setStartupName] = useState("Neuralquill");
  const [founderPersona, setFounderPersona] = useState(
    "Second-time founder, former staff engineer at a big AI lab, allergic to hype.",
  );

  const { status, transcript, error, isActive, start, stop } = useVoiceAgent();

  const onStart = async () => {
    try {
      await start(archetype, {
        dynamicVariables: {
          startup_name: startupName,
          founder_persona: founderPersona,
          prior_outcomes: "",
        },
        clientTools: {
          record_outcome: async (params: Record<string, unknown>) => {
            console.log("[record_outcome]", params);
            return "ok";
          },
        },
      });
    } catch (err) {
      // useVoiceAgent already surfaces the error into state.
      console.error("failed to start voice agent", err);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16 text-zinc-900 dark:text-zinc-100">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Voice agent sandbox
        </h1>
        <p className="text-sm text-zinc-500">
          Dev-only test harness for the ElevenLabs integration. Pick an
          archetype, fill in the dynamic variables, and talk.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Archetype</span>
          <select
            value={archetype}
            onChange={(e) => setArchetype(e.target.value as Archetype)}
            disabled={isActive}
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          >
            {ARCHETYPE_KEYS.map((key) => (
              <option key={key} value={key}>
                {ARCHETYPES[key].roleLabel} — {ARCHETYPES[key].title}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            {ARCHETYPES[archetype].voiceDescription}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Startup name</span>
          <input
            value={startupName}
            onChange={(e) => setStartupName(e.target.value)}
            disabled={isActive}
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Founder persona</span>
          <textarea
            value={founderPersona}
            onChange={(e) => setFounderPersona(e.target.value)}
            disabled={isActive}
            rows={3}
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
        </label>
      </section>

      <section className="flex items-center gap-3">
        <button
          onClick={onStart}
          disabled={isActive}
          className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          Start conversation
        </button>
        <button
          onClick={stop}
          disabled={!isActive}
          className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700"
        >
          End
        </button>
        <StatusPill status={status} />
      </section>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Transcript
        </h2>
        <div className="flex min-h-40 flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {transcript.length === 0 ? (
            <p className="text-zinc-400">No messages yet.</p>
          ) : (
            transcript.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span
                  className={`w-16 shrink-0 font-mono text-xs uppercase ${
                    entry.role === "agent"
                      ? "text-emerald-500"
                      : "text-sky-500"
                  }`}
                >
                  {entry.role}
                </span>
                <span>{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "speaking"
      ? "bg-emerald-500"
      : status === "listening"
        ? "bg-sky-500"
        : status === "connecting"
          ? "bg-amber-500"
          : status === "error"
            ? "bg-red-500"
            : "bg-zinc-400";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs font-mono uppercase dark:border-zinc-800">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {status}
    </span>
  );
}
