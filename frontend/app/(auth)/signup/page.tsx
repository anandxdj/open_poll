import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { Suspense } from "react";
import { SignupForm } from "@/features/auth";

// The auth group is noindex by default (reset and verify links); this page is a public entry point.
export const metadata: Metadata = { ...pageMetadata("/signup"), robots: { index: true, follow: true } };

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="flex min-h-dvh items-center justify-center bg-background">
          <p className="text-base text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
