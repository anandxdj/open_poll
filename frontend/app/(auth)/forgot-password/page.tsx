"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";
import { isAxiosError } from "axios";
import axios from "@/lib/api-client";
import { toast } from "sonner";
import { AuthShell, AuthStatus } from "@/features/auth/components/AuthShell";
import { AuthField, AuthSubmit } from "@/features/auth/components/fields";
import { textLink } from "@/features/landing/components/shared/styles";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error("Please enter your email address");

    setLoading(true);
    try {
      await axios.post("/auth/forgot-password", { email });
      setSubmitted(true);
      toast.success("Request received. Check your inbox.");
    } catch (err) {
      const message = isAxiosError(err) ? err.response?.data?.message : undefined;
      toast.error(message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={submitted ? "Check your inbox" : "Reset your password"}
      description={
        submitted ? "We've sent the reset link." : "Enter your email and we'll send you a link to choose a new password."
      }
    >
      {!submitted ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <AuthField
            type="email"
            id="email"
            name="email"
            label="Email address"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
          />
          <AuthSubmit loading={loading} disabled={loading}>
            Send reset link
          </AuthSubmit>
          <Button asChild variant="ghost" className="h-11 w-full rounded-2xl text-base text-muted-foreground">
            <Link href="/login">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to login
            </Link>
          </Button>
        </form>
      ) : (
        <AuthStatus
          icon={MailCheck}
          actions={
            <Button asChild className="h-11 w-full rounded-2xl text-base font-semibold shadow-lg shadow-primary/20">
              <Link href="/login">Return to login</Link>
            </Button>
          }
        >
          {/* The API answers identically whether or not an account exists. */}
          <p>
            If an account exists for <strong className="text-foreground">{email}</strong>, we&apos;ve sent a password
            reset link. The link will expire in 15 minutes.
          </p>
          <p className="mt-4 text-sm">
            Didn&apos;t receive the email? Check your spam folder or{" "}
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className={`${textLink} inline-flex min-h-11 items-center`}
            >
              try again
            </button>
            .
          </p>
        </AuthStatus>
      )}
    </AuthShell>
  );
}

