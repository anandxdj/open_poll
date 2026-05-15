"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { MorphingStoryAnimation } from "./MorphingStoryAnimation";

const ease = [0.32, 0.72, 0, 1] as const;

export function Hero() {
  return (
    <section className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6 pt-24 pb-20">
      {/* Ambient blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full bg-primary/[0.04] blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 size-[400px] rounded-full bg-blue-500/[0.04] blur-[100px]" />
      </div>

      <div
        className="absolute inset-0 pointer-events-none opacity-100"
        style={{
          backgroundImage: "radial-gradient(circle, hsl(28 50% 69% / 0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto w-full">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-8 items-center">
          {/* Left Column: Content */}
          <div className="flex flex-col items-start text-left space-y-8">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-2 backdrop-blur-sm"
            >
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium tracking-tight text-muted-foreground">
                AI-assisted poll drafts
              </span>
              <ProductLogo size={12} className="opacity-80" />
            </motion.div>

            {/* Headline */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease, delay: 0.1 }}
              className="space-y-4"
            >
              <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-[-0.04em] leading-[1.04] text-balance">
                Polls that feel{" "}
                <span className="text-primary">alive</span>
              </h1>
              <p className="max-w-[36rem] text-pretty text-lg sm:text-xl text-muted-foreground leading-relaxed">
                Create real-time interactive polls in seconds. Let AI build your
                survey, share the link, and watch responses stream in live.
              </p>
            </motion.div>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.25 }}
              className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto"
            >
              <Link
                href="/create"
                className="group w-full sm:w-auto flex items-center justify-center gap-3 rounded-2xl bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground hover:opacity-90 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] active:translate-y-px shadow-xl shadow-primary/20"
              >
                <div className="flex size-6 items-center justify-center rounded-full bg-primary-foreground/10 transition-transform duration-300 group-hover:rotate-90">
                  <ProductLogo size={14} />
                </div>
                Start creating
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/polls"
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/30 px-6 py-3.5 text-base font-medium text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:translate-y-px active:scale-[0.99]"
              >
                View dashboard
                <ChevronRight className="size-4" />
              </Link>
            </motion.div>

            {/* Social proof */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-muted-foreground/60"
            >
              {["No account needed to vote", "Free to create", "Real-time updates"].map(
                (item, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="size-1 rounded-full bg-border" />
                    {item}
                  </span>
                )
              )}
            </motion.div>
          </div>

          {/* Right Column: Animation */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease, delay: 0.2 }}
            className="relative lg:pl-8"
          >
            <MorphingStoryAnimation />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
