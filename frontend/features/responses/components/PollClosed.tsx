"use client";

import { motion } from "framer-motion";
import { Clock, Zap } from "lucide-react";
import Link from "next/link";

export function PollClosed({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 selection:bg-primary selection:text-primary-foreground">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/[0.02] blur-[100px] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="relative text-center space-y-6 max-w-sm"
      >
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute -inset-4 rounded-full bg-secondary/20 blur-xl" />
            <div className="relative flex size-16 items-center justify-center rounded-2xl border border-border bg-secondary/30">
              <Clock className="size-8 text-muted-foreground/30" />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/25">
            Poll closed
          </p>
          <h1 className="text-xl font-bold text-foreground/70 leading-snug">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground/30">
            This poll has ended or is no longer accepting responses.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/10 px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/20 transition-all"
        >
          <Zap className="size-3.5 text-primary fill-primary" />
          Open Poll
        </Link>
      </motion.div>
    </div>
  );
}
