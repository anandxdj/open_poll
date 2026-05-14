"use client";

import { motion } from "framer-motion";
import { Users } from "lucide-react";

const ease = [0.32, 0.72, 0, 1] as const;

const steps = [
  {
    n: "01",
    title: "Create your poll",
    body: "Use the builder or let AI generate a complete survey from a single prompt. Add questions, set an expiry, and customise options.",
  },
  {
    n: "02",
    title: "Share the link",
    body: "Every poll gets a unique URL. Share it in Slack, email, your event chat — anywhere your audience is.",
  },
  {
    n: "03",
    title: "Watch it happen",
    body: "Results update in real time. Monitor live vote counts and dive into the analytics dashboard when the poll closes.",
  },
];

export function Steps() {
  return (
    <section id="how-it-works" className="py-32 px-6 border-t border-border bg-secondary/[0.02]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center space-y-4 mb-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium tracking-tight text-muted-foreground">
            <Users className="size-3 text-primary" />
            How it works
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-balance">
            Three steps to live
          </h2>
        </div>

        <div className="relative">
          {/* Connecting line */}
          <div className="hidden lg:block absolute top-16 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

          <div className="grid lg:grid-cols-3 gap-12">
            {steps.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, ease, delay: i * 0.1 }}
                className="relative flex flex-col items-center text-center gap-6"
              >
                <div className="relative">
                  <div className="absolute -inset-4 rounded-full bg-primary/10 blur-xl opacity-0 group-hover:opacity-100" />
                  <div className="relative size-16 rounded-full border border-border bg-card flex items-center justify-center shadow-xl shadow-black/20">
                    <span className="text-2xl font-bold text-primary">{s.n}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-xl font-bold text-foreground/90">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                    {s.body}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
