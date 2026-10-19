"use client";

import { useEffect, useState, use } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import axios from "@/lib/api-client";
import { getApiErrorMessage } from "@/lib/api-error";
import { AuthShell, AuthStatus } from "@/features/auth/components/AuthShell";
import { authSecondaryClass } from "@/features/auth/components/fields";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function VerifyEmailPage({ params }: PageProps) {
  const { token } = use(params);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const verifyToken = async () => {
      try {
        await axios.get(`/auth/verify-email/${token}`);
        setStatus("success");
        setMessage("Your email has been successfully verified! You can now log in to your account.");
      } catch (err) {
        setStatus("error");
        setMessage(getApiErrorMessage(err) || "Invalid or expired verification link.");
      }
    };

    if (token) {
      verifyToken();
    }
  }, [token]);

  return (
    <AuthShell title="Email verification" width="sm">
      <div aria-live="polite">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center" role="status">
            <Loader2 className="size-10 animate-spin text-brand-ink" aria-hidden="true" />
            <p className="text-base text-muted-foreground">Verifying your email…</p>
          </div>
        )}

        {status === "success" && (
          <AuthStatus
            tone="success"
            title="Email verified"
            actions={
              <Button asChild className="h-11 w-full rounded-2xl text-base font-semibold shadow-lg shadow-primary/20">
                <Link href="/login">Continue to login</Link>
              </Button>
            }
          >
            {message}
          </AuthStatus>
        )}

        {status === "error" && (
          <AuthStatus
            tone="error"
            title="Verification failed"
            actions={
              <>
                <Button asChild variant="outline" className={authSecondaryClass}>
                  <Link href="/signup">Back to sign up</Link>
                </Button>
                <Button asChild variant="ghost" className="h-11 w-full rounded-2xl text-base text-muted-foreground">
                  <Link href="/">Back to home</Link>
                </Button>
              </>
            }
          >
            {message}
          </AuthStatus>
        )}
      </div>
    </AuthShell>
  );
}
