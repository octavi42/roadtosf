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

// ---------------------------------------------------------------------------
// Shared store
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
// Two <audio> elements rendered as JSX. React handles src attribute updates;
// `autoPlay` + first-gesture retry covers the autoplay-policy gap. Volume is
// set imperatively for ducking + mute.
// ---------------------------------------------------------------------------

export interface AudioBedProps {
  ambienceSrc: string | null;
  musicSrc: string | null;
}

export default function AudioBed({ ambienceSrc, musicSrc }: AudioBedProps) {
  const ambienceRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);

  const muted = useAudioBedStore((s) => s.muted);
  const dialoguePlaying = useAudioBedStore((s) => s.dialoguePlaying);

  // eslint-disable-next-line no-console
  console.log("[AudioBed] render", { ambienceSrc, musicSrc, dialoguePlaying, muted });

  useEffect(() => {
    const a = ambienceRef.current;
    // eslint-disable-next-line no-console
    console.log("[AudioBed] ambience effect", {
      ambienceSrc,
      hasRef: !!a,
      paused: a?.paused,
      readyState: a?.readyState,
      currentSrc: a?.currentSrc,
    });
  }, [ambienceSrc]);

  // Apply ambience volume / mute imperatively on every relevant change.
  useEffect(() => {
    const a = ambienceRef.current;
    if (!a) return;
    a.muted = muted;
    a.volume = dialoguePlaying ? AMBIENCE_DUCKED : AMBIENCE_GAIN;
  }, [muted, dialoguePlaying, ambienceSrc]);

  useEffect(() => {
    const m = musicRef.current;
    if (!m) return;
    m.muted = muted;
    m.volume = dialoguePlaying ? MUSIC_DUCKED : MUSIC_GAIN;
  }, [muted, dialoguePlaying, musicSrc]);

  // First user gesture: poke any paused track that has a src so the browser
  // lets it start. Listeners detach themselves after firing.
  useEffect(() => {
    const kick = () => {
      const tryPlay = (a: HTMLAudioElement | null) => {
        if (!a || !a.src) return;
        if (a.paused) void a.play().catch(() => {});
      };
      tryPlay(ambienceRef.current);
      tryPlay(musicRef.current);
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      window.removeEventListener("touchstart", kick);
    };
    window.addEventListener("pointerdown", kick, { once: false });
    window.addEventListener("keydown", kick, { once: false });
    window.addEventListener("touchstart", kick, { once: false });
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      window.removeEventListener("touchstart", kick);
    };
  }, []);

  return (
    <>
      {ambienceSrc && (
        <audio
          ref={ambienceRef}
          src={ambienceSrc}
          loop
          autoPlay
          preload="auto"
          aria-hidden="true"
          style={{ display: "none" }}
        />
      )}
      {musicSrc && (
        <audio
          ref={musicRef}
          src={musicSrc}
          loop
          autoPlay
          preload="auto"
          aria-hidden="true"
          style={{ display: "none" }}
        />
      )}
    </>
  );
}
