import { getApiOrigin, getAuthLoginUrl } from '@/lib/env';

const OIDC_UI_ORIGIN = 'https://id.anands.dev';

/** IdP / app login pages pass return_to pointing at /oauth/authorize. */
export function getSafeOidcReturnTo(returnTo: string | null | undefined): string | null {
  if (!returnTo) return null;
  try {
    const url = new URL(returnTo);
    if (url.origin === OIDC_UI_ORIGIN && url.pathname === '/oauth/authorize') {
      return url.toString();
    }
  } catch {
    // invalid URL
  }
  return null;
}

/** Resume in-flight OAuth on the API (uses PKCE cookies from /api/auth/login). */
export function getAuthContinueUrl(): string {
  return `${getApiOrigin()}/api/auth/continue`;
}

/** Start sign-in or resume OAuth after IdP login. */
export function getSsoHref(returnTo: string | null | undefined): string {
  if (getSafeOidcReturnTo(returnTo)) {
    return getAuthContinueUrl();
  }
  return getAuthLoginUrl();
}

export function hasInFlightOauth(returnTo: string | null | undefined): boolean {
  return Boolean(getSafeOidcReturnTo(returnTo));
}
