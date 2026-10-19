"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";
import { container, linkButton } from "../shared/styles";
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
    <section aria-labelledby="hero-title" className="relative overflow-hidden pb-20 pt-32 md:pb-28 md:pt-40">
      <div aria-hidden="true" className="mk-grid pointer-events-none absolute inset-0" />

      <div className={`${container} relative`}>
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <motion.h1
            {...reveal(0)}
            id="hero-title"
            className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl"
          >
            Slides your audience can answer
          </motion.h1>
          <motion.p
            {...reveal(0.08)}
            className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl"
          >
            Build a deck of polls, quizzes, word clouds and Q&amp;A, or let AI draft one from a prompt. Share a join
            code and watch every answer land live on the big screen.
          </motion.p>

          <motion.div {...reveal(0.16)} className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href={authed ? "/polls" : "/signup"} className={`${linkButton({ size: "xl" })} w-full sm:w-auto`}>
              {authed ? "Open your dashboard" : "Start for free"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link href="/live" className={`${linkButton({ variant: "outline", size: "xl" })} w-full sm:w-auto`}>
              Join a session
            </Link>
          </motion.div>
          <motion.p {...reveal(0.22)} className="mt-5 text-sm text-muted-foreground">
            Your audience joins with a code, no account needed. A free plan is available.
          </motion.p>
        </div>

        <motion.div {...reveal(0.3)} className="mx-auto mt-14 max-w-5xl md:mt-20">
          <LiveRoomPreview />
        </motion.div>
      </div>
    </section>
  );
}
