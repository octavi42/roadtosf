"use client";

import { useEffect, useRef } from "react";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Mix levels
// ---------------------------------------------------------------------------

const AMBIENCE_GAIN = 0.45;
const AMBIENCE_DUCKED = 0.2;
const MUSIC_GAIN = 0.3;
const MUSIC_DUCKED = 0.12;
const FADE_MS = 1000;
const DUCK_MS = 250;

// ---------------------------------------------------------------------------
// Shared store — DialogueSubtitle flips dialoguePlaying on TTS events; the
// mute button toggles muted. Keeps cross-component coupling thin.
// ---------------------------------------------------------------------------

interface AudioBedState {
  muted: boolean;
  dialoguePlaying: boolean;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setDialoguePlaying: (playing: boolean) => void;
}

export const useAudioBedStore = create<AudioBedState>((set) => ({
  muted: false,
  dialoguePlaying: false,
  setMuted: (muted) => set({ muted }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  setDialoguePlaying: (dialoguePlaying) => set({ dialoguePlaying }),
}));

// ---------------------------------------------------------------------------
// Two HTMLAudioElement refs (ambience + music). Volume animated on rAF for
// crossfade and ducking. No AudioContext — sidesteps the
// suspended-context-blocks-MediaElementSource trap entirely.
// ---------------------------------------------------------------------------

export interface AudioBedProps {
  ambienceSrc: string | null;
  musicSrc: string | null;
}

function animateVolume(
  audio: HTMLAudioElement,
  target: number,
  durationMs: number,
  cancelRef: { current: number },
) {
  const start = audio.volume;
  const t0 = performance.now();
  cancelAnimationFrame(cancelRef.current);
  const tick = () => {
    const t = Math.min(1, (performance.now() - t0) / Math.max(1, durationMs));
    audio.volume = start + (target - start) * t;
    if (t < 1) {
      cancelRef.current = requestAnimationFrame(tick);
    }
  };
  cancelRef.current = requestAnimationFrame(tick);
}

export default function AudioBed({ ambienceSrc, musicSrc }: AudioBedProps) {
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambienceRaf = useRef(0);
  const musicRaf = useRef(0);

  const muted = useAudioBedStore((s) => s.muted);
  const dialoguePlaying = useAudioBedStore((s) => s.dialoguePlaying);

  // First user gesture: try to start any track that is loaded but paused.
  // Browsers block autoplay until a gesture; this catches up.
  useEffect(() => {
    const kick = () => {
      const tryPlay = (a: HTMLAudioElement | null) => {
        if (!a || !a.src) return;
        if (a.paused) void a.play().catch(() => {});
      };
      tryPlay(ambienceAudioRef.current);
      tryPlay(musicAudioRef.current);
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, []);

  // Swap helper: ramp volume to 0, change src, ramp volume to base.
  const swap = (
    audio: HTMLAudioElement | null,
    raf: { current: number },
    nextSrc: string | null,
    baseGain: number,
  ) => {
    if (!audio) return;
    const currentSrc = audio.src ? new URL(audio.src).pathname : null;
    if (currentSrc === nextSrc) return;

    if (!nextSrc) {
      animateVolume(audio, 0, FADE_MS, raf);
      setTimeout(() => {
        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch {
          /* ignore */
        }
      }, FADE_MS);
      return;
    }

    // Fade out current source, then switch.
    animateVolume(audio, 0, FADE_MS / 2, raf);
    setTimeout(() => {
      audio.src = nextSrc;
      audio.volume = 0;
      const target = useAudioBedStore.getState().dialoguePlaying
        ? baseGain * (DUCK_RATIO[baseGain] ?? 0.45)
        : baseGain;
      void audio.play().catch(() => {
        // Autoplay blocked — gesture handler will retry.
      });
      animateVolume(audio, target, FADE_MS / 2, raf);
    }, FADE_MS / 2);
  };

  useEffect(() => {
    swap(ambienceAudioRef.current, ambienceRaf, ambienceSrc, AMBIENCE_GAIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambienceSrc]);

  useEffect(() => {
    swap(musicAudioRef.current, musicRaf, musicSrc, MUSIC_GAIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicSrc]);

  // Ducking — ramp to ducked / base level on dialogue play/end. Skip if the
  // track has no source loaded or the master is muted.
  useEffect(() => {
    const apply = (
      audio: HTMLAudioElement | null,
      raf: { current: number },
      base: number,
      ducked: number,
    ) => {
      if (!audio || !audio.src) return;
      animateVolume(audio, dialoguePlaying ? ducked : base, DUCK_MS, raf);
    };
    if (!muted) {
      apply(
        ambienceAudioRef.current,
        ambienceRaf,
        AMBIENCE_GAIN,
        AMBIENCE_DUCKED,
      );
      apply(musicAudioRef.current, musicRaf, MUSIC_GAIN, MUSIC_DUCKED);
    }
  }, [dialoguePlaying, muted]);

  // Mute — instant, not ramped. Just clamp volume to 0 / target.
  useEffect(() => {
    const a = ambienceAudioRef.current;
    const m = musicAudioRef.current;
    if (a) a.muted = muted;
    if (m) m.muted = muted;
  }, [muted]);

  return (
    <>
      {/* Hidden audio elements — sit off-screen but inside the DOM so the
          browser's media stack handles autoplay retries naturally. */}
      <audio
        ref={ambienceAudioRef}
        loop
        preload="auto"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <audio
        ref={musicAudioRef}
        loop
        preload="auto"
        style={{ display: "none" }}
        aria-hidden="true"
      />
    </>
  );
}

// Map base gain → ducked gain so swap()'s mid-transition target matches the
// ducking ratio for whichever track is being swapped.
const DUCK_RATIO: Record<number, number> = {
  [AMBIENCE_GAIN]: AMBIENCE_DUCKED / AMBIENCE_GAIN,
  [MUSIC_GAIN]: MUSIC_DUCKED / MUSIC_GAIN,
};
