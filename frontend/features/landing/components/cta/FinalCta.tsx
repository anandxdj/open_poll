"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";
import { button, container } from "../shared/styles";

export function FinalCta() {
  const mounted = useMounted();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authed = mounted && isAuthenticated;

  return (
    <section aria-labelledby="cta-title" className="pb-20 sm:pb-24 lg:pb-28">
      <div className={container}>
        <div className="rounded-[2rem] border border-foreground/10 bg-foreground/5 p-1.5">
          <div className="relative overflow-hidden rounded-[calc(2rem-0.375rem)] bg-card px-6 py-14 text-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.05)] sm:px-12 sm:py-20 dark:shadow-[inset_0_4px_20px_rgba(0,0,0,0.8)]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-0 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[100px]"
            />
            <div className="relative mx-auto max-w-2xl">
              <h2 id="cta-title" className="text-balance text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                Run your first live session
              </h2>
              <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                Start with a free account and have a deck ready in minutes. Joining a session someone else is
                presenting? Use the join page.
              </p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href={authed ? "/polls" : "/signup"} className={`${button.primaryLg} w-full sm:w-auto`}>
                  {authed ? "Open your dashboard" : "Start for free"}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link href="/live" className={`${button.secondaryLg} w-full sm:w-auto`}>
                  Join a session
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
