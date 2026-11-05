"use client";

import { useEffect, useState } from "react";
import { resolveDomain } from "../api/domains.api";
import { customDomainsOn, isPrimaryHost } from "../hosts";
import type { ResolvedDomain } from "../types";

/**
 * On a workspace's custom domain, what it serves (name, theme, white-label);
 * null on the main site, while loading, or when the host is unknown.
 */
export function useCustomDomain(): ResolvedDomain | null {
  const [resolved, setResolved] = useState<ResolvedDomain | null>(null);
  useEffect(() => {
    const host = window.location.host;
    if (!customDomainsOn() || isPrimaryHost(host)) return;
    let cancelled = false;
    void resolveDomain(host).then((domain) => !cancelled && setResolved(domain));
    return () => {
      cancelled = true;
    };
  }, []);
  return resolved;
}
