"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { LiveAiMockup } from "../mockups/LiveAiMockup";
import { LivePollAnimation } from "../mockups/LivePollAnimation";
import { SharePollMockup } from "../mockups/SharePollMockup";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

const ease = [0.32, 0.72, 0, 1] as const;

const rows = [
  {
    title: "Draft a deck with AI, then make it yours",
    description:
      "Describe your topic and AI proposes an outline you can review before anything is written. Each slide comes with speaker notes, and every word stays editable.",
    visual: <LiveAiMockup />,
  },
  {
    title: "Bring the room in with a code",
    description:
      "Show a short join code or QR code on screen. People join from their phones without creating an account, pick a nickname and answer when you do.",
    visual: <SharePollMockup />,
  },
  {
    title: "Watch answers arrive, keep questions flowing",
    description:
      "Results fill the screen as answers come in. Attendees can also ask questions, upvote the best ones and send emoji reactions while you present.",
    visual: <LivePollAnimation />,
  },
];

export function ShowcaseSections() {
  return (
    <section
      id="showcase"
      aria-labelledby="showcase-title"
      className={`${sectionY} scroll-mt-20 border-t border-border bg-secondary/30`}
    >
      <div className={container}>
        <SectionHeading
          id="showcase-title"
          title="From first draft to final report"
          description="Everything happens in one place, with your audience on their own phones."
        />

        <div className="mt-16 space-y-20 md:mt-20 lg:space-y-28">
          {rows.map((row, i) => (
            <div key={row.title} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-20">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.7, ease }}
                className={cn("max-w-xl", i % 2 === 1 && "lg:order-2")}
              >
                <h3 className="text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl">
                  {row.title}
                </h3>
                <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                  {row.description}
                </p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.8, ease, delay: 0.1 }}
                className={cn(i % 2 === 1 && "lg:order-1")}
              >
                {row.visual}
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
