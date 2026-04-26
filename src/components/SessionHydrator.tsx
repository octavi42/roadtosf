"use client";

import { useEffect } from "react";
import { useSessionStore, type Phase } from "@/lib/session";

const DEV_OVERRIDE_KEY = "rtsf_dev_phase";

interface DevOverride {
  phase: Phase;
  sceneIndex?: number;
}

function readDevOverride(): DevOverride | null {
  if (typeof window === "undefined") return null;
  if (process.env.NODE_ENV !== "development") return null;
  try {
    const raw = window.localStorage.getItem(DEV_OVERRIDE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DevOverride;
  } catch {
    return null;
  }
}

export default function SessionHydrator() {
  useEffect(() => {
    const override = readDevOverride();
    if (override) {
      useSessionStore
        .getState()
        .devSetPhase(override.phase, override.sceneIndex);
    }
    useSessionStore.persist.rehydrate();
  }, []);
  return null;
}
