import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import type { ProxyStep } from "./types";

/** Cookie the API sets on login. Its presence is a hint only; the API still checks the JWT. */
export const AUTH_COOKIE = "auth_session";

const AUTH_ROUTES = ["/login", "/signup"];
const PROTECTED_PREFIXES = ["/polls", "/create", "/settings", "/analytics", "/presentations"];

export const isAuthRoute = (pathname: string) => AUTH_ROUTES.includes(pathname);

export const isProtectedRoute = (pathname: string) =>
  PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/**
 * Sends signed-out visitors on protected pages to /login and signed-in
 * visitors on /login or /signup to /polls.
 */
export const authProxy: ProxyStep = (request: NextRequest) => {
  // JWT lives on the API host (localhost:5000); the proxy runs on the Next host.
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Auth pages handle session via /auth/me (API cookie on :5000). Do not redirect
  // away from /login based on auth_session alone — stale cookies block OAuth resume.

  // Redirect unauthenticated users from protected pages to login
  if (isProtectedRoute(pathname) && !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute(pathname) && token) {
    return NextResponse.redirect(new URL("/polls", request.url));
  }

  return undefined;
};
