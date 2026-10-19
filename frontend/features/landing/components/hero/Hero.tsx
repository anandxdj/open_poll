"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";
import { button, container } from "../shared/styles";
import { LiveRoomPreview } from "./LiveRoomPreview";

const ease = [0.32, 0.72, 0, 1] as const;

const POINTS = ["Audience joins with a code, no account", "Free plan available", "Results update live"];

export function Hero() {
  const mounted = useMounted();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authed = mounted && isAuthenticated;

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden pb-24 pt-28 sm:pt-32 lg:pb-32 lg:pt-40">
      <div aria-hidden="true" className="mk-dot-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 size-[38rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-[120px]"
      />

      <div className={`${container} relative`}>
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12 xl:gap-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
            className="flex flex-col items-start text-left"
          >
            <h1
              id="hero-title"
              className="text-balance text-5xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-6xl"
            >
              Slides your audience can answer
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Build a deck of polls, quizzes, word clouds and Q&amp;A, or let AI draft one from a prompt. Share a join
              code and watch every answer land live on the big screen.
            </p>

            <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href={authed ? "/polls" : "/signup"} className={`${button.primaryLg} w-full sm:w-auto`}>
                {authed ? "Open your dashboard" : "Start for free"}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link href="/live" className={`${button.secondaryLg} w-full sm:w-auto`}>
                Join a session
              </Link>
            </div>

            <ul className="mt-8 flex flex-col gap-2.5 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
              {POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-brand-ink" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease, delay: 0.15 }}
            className="pb-10 lg:pb-0"
          >
            <LiveRoomPreview />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
