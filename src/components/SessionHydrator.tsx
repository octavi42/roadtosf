"use client";

import { useEffect } from "react";
import { useSessionStore } from "@/lib/session";

export default function SessionHydrator() {
  useEffect(() => {
    void useSessionStore.persist.rehydrate();
  }, []);
  return null;
}
