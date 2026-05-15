"use client";

import { useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/features/auth";
import { toast } from "sonner";

function AuthCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setToken, checkAuth } = useAuthStore();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const token = searchParams.get("token");
    const error = searchParams.get("error");

    if (error) {
      toast.error(error);
      router.replace("/login");
      return;
    }

    if (token) {
      setToken(token);
      void (async () => {
        const ok = await checkAuth();
        if (ok) {
          toast.success("Signed in successfully!");
          router.replace("/polls");
        } else {
          toast.error("Authentication failed. Please try again.");
          router.replace("/login");
        }
      })();
    } else {
      router.replace("/login");
    }
  }, [setToken, checkAuth, router, searchParams]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-radial-glow">
      <p className="text-sm text-muted-foreground animate-pulse">Completing sign-in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-radial-glow">
        <p className="text-sm text-muted-foreground animate-pulse">Loading auth…</p>
      </div>
    }>
      <AuthCallbackHandler />
    </Suspense>
  );
}
