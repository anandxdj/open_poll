'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../store/useAuthStore';
import { takeInviteRedirect } from '@/features/workspaces/invites/pendingInvite';
import { getAuthContinueUrl, hasInFlightOauth } from '../utils/sso-redirect';

/** On login/signup, send users who already have a session to the dashboard. */
export function useAuthPageRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('return_to');
  const next = searchParams.get('next');
  const inFlightOauth = hasInFlightOauth(returnTo);
  const { checkAuth, isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      // An invitation opened before signing in comes first (workspaces/invites/pendingInvite.ts).
      router.replace(takeInviteRedirect(next) ?? '/polls');
    }
  }, [isLoading, isAuthenticated, router, next]);

  // After IdP sign-in, resume OAuth on the API (PKCE cookies → authorize → callback).
  useEffect(() => {
    if (isLoading || isAuthenticated || !inFlightOauth) return;
    window.location.assign(getAuthContinueUrl());
  }, [isLoading, isAuthenticated, inFlightOauth]);

  return {
    isLoading,
    isAuthenticated,
    isContinuingOAuth: inFlightOauth && !isLoading && !isAuthenticated,
  };
}
