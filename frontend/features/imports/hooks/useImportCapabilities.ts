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

export interface ImportCapabilities {
  /** The capabilities came back. While false nothing is claimed either way and the server has the final say. */
  known: boolean;
  storage: boolean;
  /** Slides with charts or diagrams can be rendered as pictures (Gotenberg). */
  pptxHighFidelity: boolean;
  googleDriveImport: boolean;
}

const UNKNOWN: ImportCapabilities = { known: false, storage: false, pptxHighFidelity: false, googleDriveImport: false };

/** What this deployment can import, so the dialog explains what is switched off instead of failing late. */
export function useImportCapabilities(): ImportCapabilities {
  const [state, setState] = useState<ImportCapabilities>(UNKNOWN);
  useEffect(() => {
    let active = true;
    loadCapabilities().then(
      (capabilities) => {
        if (active) {
          setState({
            known: true,
            storage: capabilities.storage,
            pptxHighFidelity: capabilities.pptxHighFidelity,
            googleDriveImport: capabilities.googleDriveImport,
          });
        }
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
