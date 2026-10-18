"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

/** `GET /api/capabilities`: optional features this deployment offers (backend env.capabilities). */
export interface Capabilities {
  billing: boolean;
  storage: boolean;
  samlSso: boolean;
  scim: boolean;
  pptxHighFidelity: boolean;
  googleDriveImport: boolean;
  customDomains: boolean;
  metrics: boolean;
  ai: boolean;
}

type ApiOk<T> = { success: boolean; message: string; data: T };

let pending: Promise<Capabilities> | null = null;

/** The deployment's capabilities, fetched once per page load (a failed fetch is retried next time). */
export function fetchCapabilities(): Promise<Capabilities> {
  pending ??= apiClient
    .get<ApiOk<Capabilities>>("/capabilities")
    .then((res) => res.data.data)
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}

export interface CapabilitiesState {
  /** Null while loading, and when they could not be read (treat every optional feature as off). */
  capabilities: Capabilities | null;
  loading: boolean;
}

export function useCapabilities(): CapabilitiesState {
  const [state, setState] = useState<CapabilitiesState>({ capabilities: null, loading: true });
  useEffect(() => {
    let active = true;
    fetchCapabilities().then(
      (capabilities) => {
        if (active) setState({ capabilities, loading: false });
      },
      () => {
        if (active) setState({ capabilities: null, loading: false });
      }
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
