"use client";

import { useEffect, useState, use } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import axios from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-error";
import { AuthShell } from "@/features/auth/components/AuthShell";
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

  if (status === "success") {
    return (
      <AuthShell aside={false} icon={CheckCircle2} tone="success" title="Email verified" description={message}>
        <Button asChild className={authSecondaryClass}>
          <Link href="/login">Continue to login</Link>
        </Button>
      </AuthShell>
    );
  }

  if (status === "error") {
    return (
      <AuthShell aside={false} icon={AlertCircle} tone="error" title="Verification failed" description={message}>
        <div className="grid gap-3">
          <Button asChild variant="outline" className={authSecondaryClass}>
            <Link href="/signup">Back to sign up</Link>
          </Button>
          <Button asChild variant="ghost" className={authSecondaryClass}>
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell aside={false} title="Verifying your email" description="This takes a moment.">
      <div role="status" className="flex items-center gap-3 text-base text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-accent-ink" aria-hidden="true" />
        Verifying your email…
      </div>
    </AuthShell>
  );
}
