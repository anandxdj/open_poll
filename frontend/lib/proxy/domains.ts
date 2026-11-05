import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { customDomainAction, customDomainsOn, isPrimaryHost } from "@/features/domains/hosts";
import { getApiOrigin } from "@/lib/env";
import { getSiteUrl } from "@/lib/seo/site";
import type { ProxyStep } from "./types";

const TTL_MS = 60_000;
const known = new Map<string, { active: boolean; until: number }>();

/** Whether the API serves this host as an active custom domain; answers are kept a minute. */
async function isActiveDomain(host: string, now = Date.now()): Promise<boolean> {
  const cached = known.get(host);
  if (cached && cached.until > now) return cached.active;
  let active = false;
  try {
    const res = await fetch(`${getApiOrigin()}/api/public/domains/resolve?host=${encodeURIComponent(host)}`, { cache: "no-store" });
    active = res.ok;
  } catch {
    // The API is unreachable: treat as unknown for now, ask again next minute.
  }
  if (known.size > 1000) known.clear();
  known.set(host, { active, until: now + TTL_MS });
  return active;
}

/**
 * A workspace's custom domain (W4-E) serves the participant side only: `/`
 * shows the join page, `/live/*`, `/r/*`, `/embed/*`, polls and assets pass,
 * everything else moves to the same path on the main site (308). Unknown
 * hosts go to the main site. Off unless NEXT_PUBLIC_CUSTOM_DOMAINS=on.
 */
export const domainsProxy: ProxyStep = async (request: NextRequest) => {
  if (!customDomainsOn()) return undefined;
  const host = request.headers.get("host") ?? "";
  if (isPrimaryHost(host)) return undefined;

  const { pathname, search } = request.nextUrl;
  const site = getSiteUrl();
  if (!(await isActiveDomain(host.toLowerCase()))) return NextResponse.redirect(new URL("/", site), 307);

  const action = customDomainAction(pathname);
  if (action === "join") return NextResponse.rewrite(new URL("/live", request.url));
  if (action === "redirect") return NextResponse.redirect(new URL(`${pathname}${search}`, site), 308);
  return undefined;
};
