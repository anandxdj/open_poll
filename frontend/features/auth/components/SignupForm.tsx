"use client";

import { Button } from "@/components/ui/button";
import { JSX, SVGProps, useState } from "react";
import Link from "next/link";
import { isAxiosError } from "axios";
import { Loader2, MailCheck } from "lucide-react";
import { textLink } from "@/features/landing/components/shared/styles";
import { AuthShell, AuthStatus } from "./AuthShell";
import { AuthDivider, AuthField, AuthSubmit, PasswordField, authSecondaryClass } from "./fields";
import axios from "@/lib/api-client";
import { toast } from "sonner";
import { getGoogleAuthUrl } from "@/lib/env";

const GoogleIcon = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
    <path d="M3.06364 7.50914C4.70909 4.24092 8.09084 2 12 2C14.6954 2 16.959 2.99095 18.6909 4.60455L15.8227 7.47274C14.7864 6.48185 13.4681 5.97727 12 5.97727C9.39542 5.97727 7.19084 7.73637 6.40455 10.1C6.2045 10.7 6.09086 11.3409 6.09086 12C6.09086 12.6591 6.2045 13.3 6.40455 13.9C7.19084 16.2636 9.39542 18.0227 12 18.0227C13.3454 18.0227 14.4909 17.6682 15.3864 17.0682C16.4454 16.3591 17.15 15.3 17.3818 14.05H12V10.1818H21.4181C21.5364 10.8363 21.6 11.5182 21.6 12.2273C21.6 15.2727 20.5091 17.8363 18.6181 19.5773C16.9636 21.1046 14.7 22 12 22C8.09084 22 4.70909 19.7591 3.06364 16.4909C2.38638 15.1409 2 13.6136 2 12C2 10.3864 2.38638 8.85911 3.06364 7.50914Z" />
  </svg>
);

const SSOIcon = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const apiErrorMessage = (err: unknown) =>
  isAxiosError(err) ? (err.response?.data?.message as string | undefined) : undefined;

export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [signedUpEmail, setSignedUpEmail] = useState<string | null>(null);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) return toast.error("Please fill in all fields");

    setLoading(true);
    try {
      await axios.post("/auth/register", { name, email, password });
      toast.success("Check your email to finish signing up.");
      setSignedUpEmail(email);
    } catch (err) {
      toast.error(apiErrorMessage(err) || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!signedUpEmail) return;
    setResending(true);
    try {
      await axios.post("/auth/resend-verification", { email: signedUpEmail });
      toast.success("If your account still needs verification, we've sent a new link.");
    } catch (err) {
      toast.error(apiErrorMessage(err) || "Failed to resend. Please try again later.");
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      title={signedUpEmail ? "Check your email" : "Create your account"}
      description={signedUpEmail ? undefined : "Build live polls, quizzes and Q&A for free."}
      footer={
        signedUpEmail ? null : (
          <>
            Already have an account?{" "}
            <Link href="/login" className={textLink}>
              Sign in
            </Link>
          </>
        )
      }
    >
      {!signedUpEmail ? (
        <>
          <form onSubmit={handleSignup} className="space-y-5">
            <AuthField
              type="text"
              id="name"
              name="name"
              label="Full name"
              autoComplete="name"
              placeholder="Alex Rivera"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
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
              autoComplete="new-password"
              placeholder="Create a password"
              hint="At least 8 characters, with one uppercase letter and one number."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <AuthSubmit loading={loading} disabled={loading}>
              Sign up
            </AuthSubmit>
          </form>

          <div className="my-6">
            <AuthDivider>or continue with</AuthDivider>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className={authSecondaryClass} disabled={true} title="Coming soon">
              <SSOIcon className="size-4" aria-hidden={true} />
              SSO
              <span className="sr-only">(coming soon)</span>
            </Button>
            <Button asChild variant="outline" className={authSecondaryClass}>
              <a href={getGoogleAuthUrl()}>
                <GoogleIcon className="size-4" aria-hidden={true} />
                Google
              </a>
            </Button>
          </div>
        </>
      ) : (
        <AuthStatus
          icon={MailCheck}
          actions={
            <>
              <Button
                onClick={handleResend}
                variant="outline"
                className={authSecondaryClass}
                disabled={resending}
              >
                {resending ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                Resend verification email
              </Button>
              <Button asChild variant="ghost" className="h-11 w-full rounded-2xl text-base text-muted-foreground">
                <Link href="/login">Return to login</Link>
              </Button>
            </>
          }
        >
          {/* The API answers identically whether or not the email is already registered. */}
          <p>
            We&apos;ve sent an email to <strong className="text-foreground">{signedUpEmail}</strong>. If this is a new
            account, click the verification link to activate it. If you already have an account, the email explains how
            to log in or reset your password.
          </p>
        </AuthStatus>
      )}
    </AuthShell>
  );
}
