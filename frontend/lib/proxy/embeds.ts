import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getApiOrigin } from "@/lib/env";
import { embedCsp, EMBED_PATH_PREFIX } from "@/lib/security/headers";
import type { ProxyStep } from "./types";

/** What the API says about one embed (`GET /api/embeds/policy`). */
export interface EmbedPolicy {
  allowed: boolean;
  reason: "NOT_FOUND" | "EMBED_DISABLED" | null;
  frameAncestors: string[];
}

export type EmbedKind = "live" | "results" | "stage";

export interface EmbedTarget {
  kind: EmbedKind;
  id: string;
  token: string | null;
}

/** `/embed/<kind>/<id>` (+ `?token=` for the stage), or null for any other path. */
export function embedTargetOf(pathname: string, searchParams: URLSearchParams): EmbedTarget | null {
  const match = /^\/embed\/(live|results|stage)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  return { kind: match[1] as EmbedKind, id, token: match[1] === "stage" ? searchParams.get("token") : null };
}

/** Header the page reads to show "embedding is off" or "link not found" instead of loading. */
export const EMBED_POLICY_HEADER = "x-openpoll-embed";

const DENIED: EmbedPolicy = { allowed: false, reason: null, frameAncestors: [] };

// Answers are kept briefly per target, so a classroom loading the same embed
// at once asks the API once; turning embedding on or off shows within seconds.
const TTL_MS = 10_000;
const cache = new Map<string, { policy: EmbedPolicy; until: number }>();

/** The API's policy for one embed; on failure, denied (and not cached). */
export async function fetchEmbedPolicy(target: EmbedTarget, now = Date.now()): Promise<EmbedPolicy> {
  const query = new URLSearchParams({ kind: target.kind, id: target.id });
  if (target.token) query.set("token", target.token);
  const key = query.toString();
  const cached = cache.get(key);
  if (cached && cached.until > now) return cached.policy;
  try {
    const res = await fetch(`${getApiOrigin()}/api/embeds/policy?${key}`, { cache: "no-store" });
    if (!res.ok) return DENIED;
    const body = (await res.json()) as { data?: EmbedPolicy };
    const policy = body.data ?? DENIED;
    if (cache.size > 2000) cache.clear();
    cache.set(key, { policy, until: now + TTL_MS });
    return policy;
  } catch {
    // The API is unreachable: the page could not load anything anyway; do not let it be framed.
    return DENIED;
  }
}

/** Forget cached answers (tests). */
export function clearEmbedPolicyCache() {
  cache.clear();
}

/**
 * Embed pages (W4-D) may be framed by other sites, but only when the deck
 * allows embedding, and only by the sites its workspace lists (any site when
 * it lists none). The API decides; this step turns the answer into the page's
 * `Content-Security-Policy: frame-ancestors …` (`'self'` when denied, so a
 * denied embed never renders inside another site) and tells the page why it
 * may not render (`x-openpoll-embed` request header). Every other path passes
 * untouched and keeps the baseline headers (`lib/security/headers.ts`).
 */
export const embedsProxy: ProxyStep = async (request: NextRequest) => {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname !== EMBED_PATH_PREFIX && !pathname.startsWith(`${EMBED_PATH_PREFIX}/`)) return undefined;

  const target = embedTargetOf(pathname, searchParams);
  const policy = target ? await fetchEmbedPolicy(target) : DENIED;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(EMBED_POLICY_HEADER, policy.allowed ? "allowed" : (policy.reason ?? "NOT_FOUND"));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", embedCsp(policy.allowed ? policy.frameAncestors : []));
  // An embed page is never shown to search engines, and never leaks its URL (a screen token) as a referrer.
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};
