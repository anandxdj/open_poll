"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Anything that throws while rendering a page. The layout around it (and the app shell) stays. */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16">
      <div role="alert" className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">This page didn&apos;t load</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Something went wrong on our side. Try again, and if it keeps happening, come back in a few minutes.
        </p>
        {error.digest ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Error reference <span className="font-mono text-foreground">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => unstable_retry()}>
            <RotateCcw /> Try again
          </Button>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "bg-card")}>
            Go to the homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
