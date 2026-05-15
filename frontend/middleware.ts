import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // JWT lives on the API host (localhost:5000); middleware runs on the Next host.
  const token = request.cookies.get('auth_session')?.value;
  const { pathname } = request.nextUrl;

  // Define route types
  const isAuthRoute = pathname === '/login' || pathname === '/signup';
  const isProtectedRoute = 
    pathname.startsWith('/polls') || 
    pathname.startsWith('/create') || 
    pathname.startsWith('/settings') || 
    pathname.startsWith('/analytics');

  // Auth pages handle session via /auth/me (API cookie on :5000). Do not redirect
  // away from /login based on auth_session alone — stale cookies block OAuth resume.

  // Redirect unauthenticated users from protected pages to login
  if (isProtectedRoute && !token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && token) {
    return NextResponse.redirect(new URL('/polls', request.url));
  }

  return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public|p/).*)',
  ],
};
