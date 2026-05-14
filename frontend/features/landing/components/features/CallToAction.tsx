"use client";

import Link from "next/link";
import { Brain, Sparkles, ArrowRight } from "lucide-react";

export function CallToAction() {
  return (
    <section className="border-t border-border px-6 pt-24 pb-32">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <div className="relative rounded-[2.5rem] border border-border bg-card p-4 shadow-2xl overflow-hidden">
          <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-br from-primary/[0.08] via-transparent to-blue-500/[0.08]" />
          <div className="relative rounded-[2rem] bg-background/80 backdrop-blur-sm border border-white/5 px-8 py-16 space-y-8">
            <div className="inline-flex size-20 items-center justify-center rounded-[2rem] bg-primary/10 ring-1 ring-primary/20 mb-2 shadow-2xl shadow-primary/10">
              <Brain className="size-10 text-primary" />
            </div>
            <div className="space-y-4">
              <h2 className="text-4xl sm:text-6xl font-bold tracking-tight text-balance">
                Ready when you are
              </h2>
              <p className="text-xl text-muted-foreground max-w-md mx-auto text-pretty leading-relaxed">
                Build your first poll in under a minute. Start from a prompt or the builder, then share the link.
              </p>
            </div>
            <Link
              href="/create"
              className="group inline-flex items-center gap-4 rounded-2xl bg-primary px-10 py-5 text-lg font-bold text-primary-foreground hover:opacity-90 hover:scale-[1.02] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] active:translate-y-px shadow-2xl shadow-primary/30"
            >
              <div className="flex size-7 items-center justify-center rounded-full bg-primary-foreground/10 transition-transform duration-500 group-hover:rotate-90">
                <Sparkles className="size-4" />
              </div>
              Create your first poll
              <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
