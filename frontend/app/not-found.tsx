import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PublicPageShell } from "@/features/landing/components/shared/PublicPageShell";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Page not found" };

/** Unknown URLs and `notFound()` anywhere in the app. Next adds noindex for the 404. */
export default function NotFound() {
  return (
    <PublicPageShell label="Page not found" width="wide">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        {/* The number plotted on graph paper, the site's one illustration language. */}
        <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
        <div className="relative px-6 py-14 sm:px-12 sm:py-20">
          <p aria-hidden="true" className="font-mono text-[clamp(5rem,18vw,9rem)] leading-none tracking-[-0.06em] text-faint">
            404
          </p>
          <h1 className="mt-6 text-balance text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
            This page doesn&apos;t exist
          </h1>
          <p className="mt-3 max-w-md text-base text-muted-foreground">
            The link may be old or mistyped. If someone sent it to you, ask them for a new one.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link href="/" className={buttonVariants()}>
              Go to the homepage
            </Link>
            <Link href="/live" className={cn(buttonVariants({ variant: "outline" }), "bg-card")}>
              Join a session
            </Link>
          </div>
        </div>
      </div>
    </PublicPageShell>
  );
}
