"use client";

import { motion } from "framer-motion";
import { 
  Zap, 
  Sparkles, 
  BarChart3, 
  Fingerprint, 
  Globe, 
  Layers 
} from "lucide-react";
import { cn } from "@/lib/utils";

const ease = [0.32, 0.72, 0, 1] as const;

const features = [
  {
    icon: Zap,
    title: "Real-time responses",
    description: "Watch votes stream in live as your audience participates. Every answer reflected instantly — no refresh needed.",
    accent: "text-primary",
    bg: "bg-primary/10",
    className: "md:col-span-2 lg:col-span-2",
  },
  {
    icon: Sparkles,
    title: "AI-assisted drafts",
    description: "Describe your topic and let the model propose questions and balanced options.",
    accent: "text-blue-500",
    bg: "bg-blue-500/10",
    className: "md:col-span-1 lg:col-span-1",
  },
  {
    icon: BarChart3,
    title: "Live analytics",
    description: "Visualize response distributions and track completion rates for every poll.",
    accent: "text-cyan-500",
    bg: "bg-cyan-500/10",
    className: "md:col-span-1 lg:col-span-1",
  },
  {
    icon: Fingerprint,
    title: "Anonymous by default",
    description: "Respondents can vote without accounts. Full anonymity mode keeps identifiers out.",
    accent: "text-indigo-500",
    bg: "bg-indigo-500/10",
    className: "md:col-span-1 lg:col-span-1",
  },
  {
    icon: Globe,
    title: "Share anywhere",
    description: "Every poll gets a clean, shareable link that works on any device.",
    accent: "text-sky-500",
    bg: "bg-sky-500/8",
    className: "md:col-span-1 lg:col-span-1",
  },
  {
    icon: Layers,
    title: "Multi-question surveys",
    description: "Stack as many questions as you need. Respondents flow through each one seamlessly.",
    accent: "text-blue-600",
    bg: "bg-blue-600/10",
    className: "md:col-span-2 lg:col-span-1",
  },
];

export function BentoGrid() {
  return (
    <section id="features" className="px-6 pt-28 pb-32">
      <div className="max-w-7xl mx-auto">
        <div className="text-center space-y-4 mb-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium tracking-tight text-muted-foreground">
            <Layers className="size-3 text-primary" />
            Features
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-balance">
            Everything you need
          </h2>
          <p className="max-w-xl mx-auto text-muted-foreground text-lg text-pretty leading-relaxed">
            A complete toolkit for running live polls: builder, sharing, and results in one place.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
          {features.map((f, i) => (
            <FeatureCard key={f.title} feature={f} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature, index }: { feature: any; index: number }) {
  const Icon = feature.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, ease, delay: index * 0.06 }}
      className={cn(
        "group relative rounded-[2rem] border border-border bg-card p-8 overflow-hidden transition-all duration-500 hover:border-primary/20 hover:shadow-2xl hover:shadow-primary/5",
        feature.className
      )}
    >
      <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-primary/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      <div className="relative h-full flex flex-col justify-between space-y-8">
        <div
          className={cn(
            "inline-flex size-14 items-center justify-center rounded-2xl ring-1 ring-border shadow-sm transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3",
            feature.bg
          )}
        >
          <Icon className={cn("size-6", feature.accent)} strokeWidth={1.5} />
        </div>
        <div className="space-y-3">
          <h3 className="text-xl font-bold text-foreground/90">{feature.title}</h3>
          <p className="text-base text-muted-foreground leading-relaxed">
            {feature.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
