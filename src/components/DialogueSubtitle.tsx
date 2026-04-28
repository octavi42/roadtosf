"use client";

import { useEffect, useRef, useState } from "react";

import { useDialogueAudio } from "@/hooks/useDialogueAudio";

export interface DialogueSubtitleProps {
  text: string;
  wordInterval?: number;
  onComplete?: () => void;
  instant?: boolean;
  // When set, the line is voiced via /api/tts and word-reveal is driven by
  // the audio's currentTime against returned alignment timestamps. Falls
  // back to fixed cadence on fetch error or autoplay block.
  voiceId?: string | null;
}

type AnimPhase = "in" | "out" | "done";

export default function DialogueSubtitle({
  text,
  wordInterval = 110,
  onComplete,
  instant = false,
  voiceId,
}: DialogueSubtitleProps) {
  const words = text.trim().split(/\s+/);
  const [visibleCount, setVisibleCount] = useState(instant ? words.length : 0);
  const [animPhase, setAnimPhase] = useState<AnimPhase>(instant ? "out" : "in");
  const [audioStarted, setAudioStarted] = useState(false);
  const [audioEnded, setAudioEnded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const { audioUrl, wordStartsMs, status } = useDialogueAudio({
    voiceId,
    text,
    enabled: !instant && !!voiceId,
  });

  // Whether the audio path is actively driving word-reveal.
  const audioDriving = audioStarted && !!wordStartsMs;
  // Whether to wait for audio (instead of fixed-cadence fade) before
  // exiting the line. True iff audio is in flight or already playing.
  const audioPending =
    !!voiceId && status !== "error" && status !== "idle";

  // Reset state when text changes.
  useEffect(() => {
    setVisibleCount(instant ? words.length : 0);
    setAnimPhase(instant ? "out" : "in");
    setAudioStarted(false);
    setAudioEnded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, instant]);

  // Fixed-cadence path: runs only while audio isn't driving.
  useEffect(() => {
    if (animPhase !== "in") return;
    if (audioDriving) return;
    // While audio is still loading/buffering, hold all words hidden so
    // we don't race ahead of the speech. Audio's onPlaying will flip
    // audioStarted and let the audio-driven path take over.
    if (audioPending && !audioStarted && !audioEnded) return;
    if (visibleCount >= words.length) {
      // All words shown via fixed cadence. If audio is still expected,
      // wait for the audio.ended path to trigger fade. Otherwise hold
      // 820ms then fade out.
      if (audioPending && !audioEnded) return;
      const holdId = setTimeout(() => setAnimPhase("out"), 820);
      return () => clearTimeout(holdId);
    }
    const id = setTimeout(() => {
      setVisibleCount((n) => n + 1);
    }, wordInterval);
    return () => clearTimeout(id);
  }, [
    visibleCount,
    words.length,
    wordInterval,
    animPhase,
    audioDriving,
    audioPending,
    audioStarted,
    audioEnded,
  ]);

  // Audio-driven word reveal: tick on timeupdate, advance visibleCount to
  // the highest word whose start <= currentTime. Never moves backwards.
  const handleTimeUpdate = () => {
    const el = audioRef.current;
    if (!el || !wordStartsMs) return;
    const ms = el.currentTime * 1000;
    let idx = 0;
    for (let i = 0; i < wordStartsMs.length; i++) {
      if (wordStartsMs[i] <= ms) idx = i + 1;
      else break;
    }
    setVisibleCount((prev) => (idx > prev ? idx : prev));
  };

  const handleAudioPlaying = () => setAudioStarted(true);
  const handleAudioEnded = () => {
    setAudioEnded(true);
    setVisibleCount(words.length);
    // Short tail before fade so the last word doesn't disappear instantly.
    setTimeout(() => setAnimPhase("out"), 200);
  };
  const handleAudioError = () => {
    // Stop waiting on audio; let fixed cadence finish the line.
    setAudioEnded(true);
  };

  const handleTransitionEnd = () => {
    if (animPhase === "out") {
      setAnimPhase("done");
      onCompleteRef.current?.();
    }
  };

  if (animPhase === "done") return null;

  return (
    <div
      className="w-full max-w-2xl mx-auto"
      style={{
        opacity: animPhase === "out" ? 0 : 1,
        transition: animPhase === "out" ? "opacity 0.5s ease" : "none",
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="speech-bubble px-6 py-4 animate-bounce-in">
        <p
          className="font-sans text-[var(--color-ink)] text-lg leading-snug"
          style={{ letterSpacing: "-0.005em", fontWeight: 500 }}
          aria-live="polite"
          aria-label={text}
        >
          {words.map((word, i) => {
            const visible = i < visibleCount;
            const isCurrent = i === visibleCount - 1;
            return (
              <span
                key={`${text}-${i}`}
                className="inline-block mr-[0.3em]"
                style={{
                  opacity: visible ? 1 : 0,
                  color: isCurrent
                    ? "var(--color-sunset-deep)"
                    : "var(--color-ink)",
                  transition: visible
                    ? "opacity 0.12s ease, color 0.5s ease"
                    : "none",
                }}
              >
                {word}
              </span>
            );
          })}
        </p>
      </div>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          autoPlay
          onPlaying={handleAudioPlaying}
          onEnded={handleAudioEnded}
          onError={handleAudioError}
          onTimeUpdate={handleTimeUpdate}
          style={{ display: "none" }}
        />
      )}
    </div>
  );
}
