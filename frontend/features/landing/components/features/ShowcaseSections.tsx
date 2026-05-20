"use client";

import { motion } from "framer-motion";
import { 
  LiveAiMockup, 
  LivePollAnimation, 
  SharePollMockup 
} from "@/features/landing";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const ease = [0.32, 0.72, 0, 1] as const;

const sections = [
  {
    title: "Build with the speed of thought",
    description: "Describe your poll and let our AI handle the questions, options, and settings. No more writer's block — just pure creation.",
    visual: <LiveAiMockup />,
    align: "left", // Visual on left, text on right
  },
  {
    title: "Share anywhere instantly",
    description: "Generate clean, permanent links or QR codes. Embed your polls directly into your website or share them across social platforms.",
    visual: <SharePollMockup />,
    align: "right", // Visual on right, text on left
  },
  {
    title: "Watch the pulse of your audience",
    description: "Every vote is reflected instantly. Experience sub-millisecond latency that makes your polls feel alive and engaging.",
    visual: <LivePollAnimation />,
    align: "left", // Visual on left, text on right
  },
];

export function ShowcaseSections() {
  return (
    <div className="space-y-32 pb-32">
      {/* Intro narrative header */}
      <section className="px-6 text-center pt-16 scroll-mt-20" id="showcase-intro">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3.5 py-1.5 text-xs font-bold tracking-widest text-primary uppercase">
            <Sparkles className="size-3" />
            THE EXPERIENCE
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-balance">
            The Magic in Action
          </h2>
          <p className="max-w-2xl mx-auto text-muted-foreground text-base sm:text-lg leading-relaxed">
            Watch the journey unfold. A state-of-the-art interactive experience tailored for gathering high-quality responses.
          </p>
        </div>
      </section>

      {sections.map((section, idx) => (
        <section key={idx} className="px-6">
          <div className="max-w-7xl mx-auto">
            <div className={cn(
              "grid lg:grid-cols-2 gap-12 lg:gap-24 items-center",
              section.align === "right" && "lg:direction-rtl" // This is a trick, but let's use flex-row-reverse instead for better control
            )}>
              {/* Text Content */}
              <motion.div 
                initial={{ opacity: 0, x: section.align === "left" ? 20 : -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8, ease, delay: 0.2 }}
                className={cn(
                  "space-y-6 flex flex-col justify-center",
                  section.align === "left" ? "lg:order-2" : "lg:order-1"
                )}
              >
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground/90 leading-[1.1]">
                  {section.title}
                </h2>
                <p className="text-muted-foreground text-lg sm:text-xl leading-relaxed max-w-xl">
                  {section.description}
                </p>
              </motion.div>

              {/* Visual Component */}
              <motion.div 
                initial={{ opacity: 0, x: section.align === "left" ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8, ease }}
                className={cn(
                  "relative",
                  section.align === "left" ? "lg:order-1" : "lg:order-2"
                )}
              >
                {section.visual}
              </motion.div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
