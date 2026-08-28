import { getApiOrigin } from '@/lib/env';

/**
 * The development redirect URI is registered on the Next.js origin. Relay the
 * untouched authorization response to the backend, where the HttpOnly OIDC
 * transaction cookie, PKCE verifier, and client secret are available.
 */
export function GET(request: Request) {
  const incoming = new URL(request.url);
  const backendCallback = new URL('/api/auth/google/callback', getApiOrigin());
  backendCallback.search = incoming.search;
  return Response.redirect(backendCallback, 302);
}
