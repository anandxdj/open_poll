"use client";

import { useEffect, useState } from "react";

import { getCapabilities } from "@/features/workspaces/api/workspaces.api";

let pending: Promise<boolean> | null = null;

/** `capabilities.ai` once per page load; a failed fetch is retried next time. */
function loadAiCapability(): Promise<boolean> {
  pending ??= getCapabilities().then(
    (capabilities) => capabilities.ai,
    (error: unknown) => {
      pending = null;
      throw error;
    }
  );
  return pending;
}

/**
 * Whether the server has an AI provider (`GET /api/capabilities`): true, false,
 * or null while loading or when the capabilities cannot be read (nothing is claimed then).
 */
export function useAiAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    loadAiCapability().then(
      (value) => {
        if (active) setAvailable(value);
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, []);
  return available;
}
