"use client";

import { useCallback, useEffect, useState } from "react";
import { getThemeCatalog, listBrandKits } from "../api/themes.api";
import type { BrandKit, ThemeCatalog } from "../types";

interface Loaded {
  attempt: number;
  catalog: ThemeCatalog | null;
  kits: BrandKit[];
}

/**
 * The built-in themes and fonts, plus the workspace's brand kits when
 * `withKits` (the plan has them; otherwise the API answers 403). `reload`
 * re-reads after a kit changes.
 */
export function useThemeCatalog(withKits: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getThemeCatalog(), withKits ? listBrandKits() : Promise.resolve([])]).then(
      ([catalog, kits]) => !cancelled && setLoaded({ attempt, catalog, kits }),
      () => !cancelled && setLoaded({ attempt, catalog: null, kits: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, withKits]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const current = loaded?.attempt === attempt ? loaded : null;
  return {
    catalog: current?.catalog ?? loaded?.catalog ?? null,
    kits: current?.kits ?? loaded?.kits ?? [],
    loading: current === null,
    failed: current !== null && current.catalog === null,
    reload,
  };
}
