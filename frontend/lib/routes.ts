// App paths used from more than one place.

/** Where a signed-in creator lands: after sign-in, from the logo and after switching workspace. */
export const HOME_PATH = "/home";

// "/presentation" also covers "/presentations" (deck sessions and reports).
const PROTECTED_PREFIXES = ["/home", "/polls", "/create", "/settings", "/analytics", "/presentation"];

/** App pages only a signed-in creator can open (the proxy sends others to /login). */
export const isProtectedRoute = (pathname: string) =>
  PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
