"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";
import { container, linkButton, pill } from "../shared/styles";
import { LiveRoomPreview } from "./LiveRoomPreview";

const ease = [0.32, 0.72, 0, 1] as const;

const reveal = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease, delay },
});

export function Hero() {
  const mounted = useMounted();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authed = mounted && isAuthenticated;

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden pb-20 pt-28 md:pb-28 md:pt-36">
      <div aria-hidden="true" className="mk-grid pointer-events-none absolute inset-0" />

      <div className={`${container} relative`}>
        <motion.h1
          {...reveal(0)}
          id="hero-title"
          className="max-w-[11em] text-balance text-[clamp(3rem,9vw,6.75rem)] font-semibold leading-[0.94] tracking-[-0.05em]"
        >
          Slides your audience can{" "}
          {/* The one serif word on the site: the thing the product is for. */}
          <span className="font-serif text-[1.08em] font-normal italic tracking-[-0.02em] text-brand">answer</span>.
        </motion.h1>

        <div className="mt-8 grid gap-8 md:mt-10 lg:grid-cols-12 lg:items-end">
          <motion.p
            {...reveal(0.08)}
            className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl lg:col-span-6"
          >
            Build a deck of polls, quizzes, word clouds and Q&amp;A, or let AI draft one from a prompt. Share a join
            code and watch every answer land live on the big screen.
          </motion.p>

          <motion.div {...reveal(0.16)} className="lg:col-span-6 lg:justify-self-end">
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                href={authed ? "/polls" : "/signup"}
                className={cn(linkButton({ size: "xl" }), pill, "w-full sm:w-auto")}
              >
                {authed ? "Open your dashboard" : "Start for free"}
              </Link>
              <Link
                href="/live"
                className={cn(linkButton({ variant: "outline", size: "xl" }), pill, "w-full bg-background sm:w-auto")}
              >
                Join a session
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground lg:text-right">
              Your audience joins with a code, no account needed. A free plan is available.
            </p>
          </motion.div>
        </div>

        <motion.div {...reveal(0.28)} className="mt-14 md:mt-20">
          <LiveRoomPreview />
        </motion.div>
      </div>
    </section>
  );
}
