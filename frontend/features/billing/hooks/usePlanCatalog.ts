"use client";

import { useEffect, useState } from "react";
import { getPlanCatalog } from "../api/billing.api";
import { FALLBACK_CATALOG } from "../lib/catalog";
import type { PlanCatalog } from "../types";

let request: Promise<PlanCatalog> | null = null;

/**
 * GET /api/plans, once per page load. Until it answers, and when it fails, the
 * static fallback is shown (`source: "fallback"`), so the pricing never blanks.
 */
export function usePlanCatalog(): { catalog: PlanCatalog; source: "api" | "fallback" } {
  const [loaded, setLoaded] = useState<PlanCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    request ??= getPlanCatalog().catch((error: unknown) => {
      request = null;
      throw error;
    });
    request.then(
      (value) => {
        if (!cancelled) setLoaded(value);
      },
      () => {
        // Keep the fallback.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return loaded ? { catalog: loaded, source: "api" } : { catalog: FALLBACK_CATALOG, source: "fallback" };
}
