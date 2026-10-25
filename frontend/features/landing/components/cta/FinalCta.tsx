"use client";

import Link from "next/link";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";
import { container, linkButton, pill } from "../shared/styles";

export function FinalCta() {
  const mounted = useMounted();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authed = mounted && isAuthenticated;

  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden border-t border-border">
      {/* The page ends on the same graph paper it opened with. */}
      <div aria-hidden="true" className="mk-grid pointer-events-none absolute inset-0" />
      <div className={cn(container, "relative grid gap-10 py-20 md:py-28 lg:grid-cols-12 lg:items-end")}>
        <div className="lg:col-span-7">
          <h2
            id="cta-title"
            className="text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-5xl lg:text-[3.5rem]"
          >
            Run your first live session
          </h2>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Start with a free account and have a deck ready in minutes. Joining a session someone else is presenting?
            Use the join page.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:col-span-5 lg:justify-end">
          <Link href={authed ? "/polls" : "/signup"} className={cn(linkButton({ size: "xl" }), pill, "w-full sm:w-auto")}>
            {authed ? "Open your dashboard" : "Start for free"}
          </Link>
          <Link
            href="/live"
            className={cn(linkButton({ variant: "outline", size: "xl" }), pill, "w-full bg-background sm:w-auto")}
          >
            Join a session
          </Link>
        </div>
      </div>
    </section>
  );
}
