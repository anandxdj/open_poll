import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authProxy } from "./auth";
import { domainsProxy } from "./domains";
import type { ProxyStep } from "./types";

export type { ProxyStep } from "./types";

/**
 * Ordered request chain run by `proxy.ts`. The first step that returns a
 * response wins; when none does, the request continues to the app. A feature
 * adds its step with one line here, placed where it must run.
 */
export const PROXY_CHAIN: ProxyStep[] = [
  // A custom domain first: it never serves the signed-in app.
  domainsProxy,
  authProxy,
];

export async function runProxyChain(request: NextRequest, chain: ProxyStep[] = PROXY_CHAIN): Promise<Response> {
  for (const step of chain) {
    const response = await step(request);
    if (response) return response;
  }
  return NextResponse.next();
}
