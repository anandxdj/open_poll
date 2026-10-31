"use client";

import { Button } from "@/components/ui/button";
import { JSX, SVGProps, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isAxiosError } from "axios";
import { textLink } from "@/features/landing/components/shared/styles";
import { cn } from "@/lib/utils";
import { AuthShell } from "./AuthShell";
import { AuthDivider, AuthField, AuthSubmit, PasswordField, authSecondaryClass } from "./fields";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import axios from "@/lib/api-client";
import { toast } from "sonner";
import { getGoogleAuthUrl } from "@/lib/env";
import { SsoDiscovery, ssoLoginUrl } from "@/features/sso/components/SsoDiscovery";
import { discoverSso } from "@/features/sso/api/sso.api";
import { takeInviteRedirect } from "@/features/workspaces/invites/pendingInvite";

const GoogleIcon = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
    <path d="M3.06364 7.50914C4.70909 4.24092 8.09084 2 12 2C14.6954 2 16.959 2.99095 18.6909 4.60455L15.8227 7.47274C14.7864 6.48185 13.4681 5.97727 12 5.97727C9.39542 5.97727 7.19084 7.73637 6.40455 10.1C6.2045 10.7 6.09086 11.3409 6.09086 12C6.09086 12.6591 6.2045 13.3 6.40455 13.9C7.19084 16.2636 9.39542 18.0227 12 18.0227C13.3454 18.0227 14.4909 17.6682 15.3864 17.0682C16.4454 16.3591 17.15 15.3 17.3818 14.05H12V10.1818H21.4181C21.5364 10.8363 21.6 11.5182 21.6 12.2273C21.6 15.2727 20.5091 17.8363 18.6181 19.5773C16.9636 21.1046 14.7 22 12 22C8.09084 22 4.70909 19.7591 3.06364 16.4909C2.38638 15.1409 2 13.6136 2 12C2 10.3864 2.38638 8.85911 3.06364 7.50914Z" />
  </svg>
);

// The backend redirects failed SSO/Google sign-ins to /login?error=<code>.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  sso_unavailable: "Single sign-on is unavailable right now. Please try again later.",
  sso_expired: "Your sign-in session expired. Please try again.",
  sso_failed: "Single sign-on failed. Please try again.",
  sso_required: "Your organization signs in with single sign-on. Use Continue with SSO.",
  sso_domain: "Your identity provider sent an email outside your organization's verified domains.",
  sso_no_account: "There is no account for you in this workspace yet. Ask an admin to add you.",
  sso_suspended: "Your access to this workspace was turned off. Ask an admin.",
  sso_seats: "The workspace has no free seat. Ask an admin.",
  sso_disabled: "Single sign-on is off for this workspace.",
  google_unavailable: "Google sign-in is unavailable right now.",
  google_failed: "Google sign-in failed. Please try again.",
};

const SSOIcon = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = searchParams.get("error");
  // Set by the privacy page after the account asked to be deleted: the purge date.
  const scheduledDeletion = Date.parse(searchParams.get("deleted") ?? "");
  const shownAuthError = useRef(false);
  const { setToken, setUser } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authError || shownAuthError.current) return;
    shownAuthError.current = true;
    toast.error(AUTH_ERROR_MESSAGES[authError] ?? "Sign-in failed. Please try again.");
    router.replace("/login");
  }, [authError, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return toast.error("Please fill in all fields");

    setLoading(true);
    try {
      const res = await axios.post("/auth/login", { email, password });
      const { user, accessToken, restored } = res.data.data;
      
      setToken(accessToken);
      setUser(user);
      
      // `restored`: this sign-in cancelled the account's scheduled deletion.
      toast.success(restored ? "Welcome back. Your account will not be deleted." : "Welcome back!");
      // Back to an invitation the user opened before signing in, else the dashboard.
      router.push(takeInviteRedirect(searchParams.get("next")) ?? "/polls");
    } catch (err) {
      // The organization requires single sign-on: go there with the email filled in.
      if (isAxiosError(err) && err.response?.data?.code === "SSO_REQUIRED") {
        toast.message("Your organization signs in with single sign-on.");
        const found = await discoverSso(email);
        if (found) return window.location.assign(ssoLoginUrl(found.loginUrl, email));
      }
      const message = isAxiosError(err) ? err.response?.data?.message : undefined;
      toast.error(message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Log in to your account"
      description="Welcome back. Enter your details to continue."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/signup" className={textLink}>
            Sign up
          </Link>
        </>
      }
    >
      {Number.isFinite(scheduledDeletion) ? (
        <p role="status" className="mb-6 rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">
          Your account will be deleted on{" "}
          {new Date(scheduledDeletion).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Log in
          before then to keep it.
        </p>
      ) : null}
      <form onSubmit={handleLogin} className="space-y-5">
        <AuthField
          type="email"
          id="email"
          name="email"
          label="Email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
        <PasswordField
          id="password"
          name="password"
          label="Password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          aside={
            <Link href="/forgot-password" className={cn(textLink, "inline-flex min-h-10 items-center text-sm")}>
              Forgot password?
            </Link>
          }
        />
        <AuthSubmit loading={loading} disabled={loading}>
          Sign in
        </AuthSubmit>
      </form>

      <div className="my-6">
        <AuthDivider>or</AuthDivider>
      </div>

      <div className="grid gap-3">
        <Button asChild variant="outline" className={authSecondaryClass}>
          <a href={getGoogleAuthUrl()}>
            <GoogleIcon className="size-4" aria-hidden={true} />
            Continue with Google
          </a>
        </Button>
        <SsoDiscovery email={email} Icon={SSOIcon} />
      </div>
    </AuthShell>
  );
}
