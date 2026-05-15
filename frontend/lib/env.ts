/** API origin without `/api` suffix (e.g. http://localhost:5000). */
export function getApiOrigin(): string {
  const value = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  return value.replace(/\/api\/?$/, '');
}

/** Axios base URL including `/api`. */
export function getApiBaseUrl(): string {
  return `${getApiOrigin()}/api`;
}

/** Full-page redirect target that starts the OIDC login flow on the backend. */
export function getAuthLoginUrl(): string {
  return `${getApiOrigin()}/api/auth/login`;
}

/** Full-page redirect target that starts the Google OAuth flow on the backend. */
export function getGoogleAuthUrl(): string {
  return `${getApiOrigin()}/api/auth/google`;
}
