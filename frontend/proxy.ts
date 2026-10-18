import type { NextRequest } from "next/server";

import { runProxyChain } from "@/lib/proxy";

// Steps live in lib/proxy (one file per concern, ordered in lib/proxy/index.ts).
export function proxy(request: NextRequest) {
  return runProxyChain(request);
}

// The matcher must stay a literal here: Next.js reads it statically at build time.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public files)
     * - p/ (public poll pages)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public|p/).*)',
  ],
};
