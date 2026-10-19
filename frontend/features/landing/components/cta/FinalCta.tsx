"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";
import { container, linkButton } from "../shared/styles";

export function FinalCta() {
  const mounted = useMounted();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authed = mounted && isAuthenticated;

  return (
    <section aria-labelledby="cta-title" className="border-t border-border bg-card">
      <div className={`${container} py-20 text-center md:py-28`}>
        <div className="mx-auto max-w-2xl">
          <h2 id="cta-title" className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl lg:text-5xl">
            Run your first live session
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Start with a free account and have a deck ready in minutes. Joining a session someone else is presenting?
            Use the join page.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={authed ? "/polls" : "/signup"} className={`${linkButton({ size: "xl" })} w-full sm:w-auto`}>
              {authed ? "Open your dashboard" : "Start for free"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link href="/live" className={`${linkButton({ variant: "outline", size: "xl" })} w-full sm:w-auto`}>
              Join a session
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
