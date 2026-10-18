"use client";

import { useEffect, useState } from "react";
import { getCapabilities } from "@/features/workspaces/api/workspaces.api";
import type { Capabilities } from "@/features/workspaces/types";

let pending: Promise<Capabilities> | null = null;

/** `GET /api/capabilities`, once per page load (a failed fetch is retried next time). */
function loadCapabilities(): Promise<Capabilities> {
  pending ??= getCapabilities().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

export interface StorageAvailability {
  /** Uploads to object storage work (`capabilities.storage`). False while loading or unknown. */
  storage: boolean;
  loading: boolean;
}

/**
 * Whether media pickers can upload files. When the capabilities cannot be
 * read, uploads count as unavailable and pickers fall back to links.
 */
export function useStorageAvailable(): StorageAvailability {
  const [state, setState] = useState<StorageAvailability>({ storage: false, loading: true });
  useEffect(() => {
    let active = true;
    loadCapabilities().then(
      (capabilities) => {
        if (active) setState({ storage: capabilities.storage, loading: false });
      },
      () => {
        if (active) setState({ storage: false, loading: false });
      }
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
