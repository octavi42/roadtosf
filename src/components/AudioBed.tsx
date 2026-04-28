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
const FADE_SECONDS = 1;
const DUCK_SECONDS = 0.25;

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
// Single-track player. One AudioContext, two MediaElementSource → GainNode
// chains (ambience + music). On src change we crossfade with sample-accurate
// gain ramps; on dialogue play we duck both beds.
// ---------------------------------------------------------------------------

export interface AudioBedProps {
  ambienceSrc: string | null;
  musicSrc: string | null;
}

interface Track {
  audio: HTMLAudioElement;
  gain: GainNode;
  baseGain: number;
  duckedGain: number;
  src: string | null;
}

export default function AudioBed({ ambienceSrc, musicSrc }: AudioBedProps) {
  const ctxRef = useRef<AudioContext | null>(null);
  const ambienceRef = useRef<Track | null>(null);
  const musicRef = useRef<Track | null>(null);
  const masterRef = useRef<GainNode | null>(null);

  const muted = useAudioBedStore((s) => s.muted);
  const dialoguePlaying = useAudioBedStore((s) => s.dialoguePlaying);

  // Lazy-init audio graph. Browsers block AudioContext until a user gesture;
  // resume() is called from the gesture path further down.
  const ensureGraph = () => {
    if (ctxRef.current) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    const buildTrack = (baseGain: number, duckedGain: number): Track => {
      const audio = new Audio();
      audio.loop = true;
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";
      const src = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(master);
      return { audio, gain, baseGain, duckedGain, src: null };
    };

    ctxRef.current = ctx;
    masterRef.current = master;
    ambienceRef.current = buildTrack(AMBIENCE_GAIN, AMBIENCE_DUCKED);
    musicRef.current = buildTrack(MUSIC_GAIN, MUSIC_DUCKED);
  };

  // Resume the AudioContext on the first user gesture anywhere in the
  // document. After that, the listeners detach themselves. Also retries
  // play() on each loaded track — the initial swapTrack() before any
  // gesture would have been blocked by autoplay policy.
  useEffect(() => {
    const resume = () => {
      ensureGraph();
      const ctx = ctxRef.current;
      if (ctx && ctx.state === "suspended") {
        void ctx.resume();
      }
      const retry = (track: Track | null) => {
        if (!track || !track.src) return;
        if (track.audio.paused) {
          void track.audio.play().catch(() => {});
        }
      };
      retry(ambienceRef.current);
      retry(musicRef.current);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, []);

  // Crossfade a track to a new src. Pass null to fade out and pause.
  const swapTrack = (track: Track | null, nextSrc: string | null) => {
    const ctx = ctxRef.current;
    if (!ctx || !track) return;
    if (track.src === nextSrc) return;

    const now = ctx.currentTime;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);

    const previousAudio = track.audio;
    setTimeout(() => {
      try {
        previousAudio.pause();
      } catch {
        // ignore pause races
      }
    }, FADE_SECONDS * 1000);

    if (!nextSrc) {
      track.src = null;
      return;
    }

    track.audio.src = nextSrc;
    track.src = nextSrc;
    const target = dialoguePlaying ? track.duckedGain : track.baseGain;

    void track.audio.play().catch(() => {
      // Autoplay blocked or src 404; bed stays silent. The user gesture
      // listener will retry on next interaction.
    });

    // Schedule the fade-in slightly after the play() call so the audio
    // element has a chance to start producing samples.
    const start = ctx.currentTime;
    track.gain.gain.cancelScheduledValues(start);
    track.gain.gain.setValueAtTime(0, start);
    track.gain.gain.linearRampToValueAtTime(target, start + FADE_SECONDS);
  };

  useEffect(() => {
    ensureGraph();
    swapTrack(ambienceRef.current, ambienceSrc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambienceSrc]);

  useEffect(() => {
    ensureGraph();
    swapTrack(musicRef.current, musicSrc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicSrc]);

  // Ducking: ramp current track gains to ducked / base levels.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const apply = (track: Track | null) => {
      if (!track || !track.src) return;
      const target = dialoguePlaying ? track.duckedGain : track.baseGain;
      const now = ctx.currentTime;
      track.gain.gain.cancelScheduledValues(now);
      track.gain.gain.setValueAtTime(track.gain.gain.value, now);
      track.gain.gain.linearRampToValueAtTime(target, now + DUCK_SECONDS);
    };
    apply(ambienceRef.current);
    apply(musicRef.current);
  }, [dialoguePlaying]);

  // Mute: toggle the master gain. Instant, not ramped — mute should feel
  // immediate.
  useEffect(() => {
    const master = masterRef.current;
    if (!master) return;
    master.gain.value = muted ? 0 : 1;
  }, [muted]);

  return null;
}
