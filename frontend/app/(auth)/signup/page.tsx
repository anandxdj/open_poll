import { Suspense } from "react";
import { SignupForm } from "@/features/auth";

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-radial-glow">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
