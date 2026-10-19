"use client";

import { motion } from "framer-motion";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

const ease = [0.32, 0.72, 0, 1] as const;

const steps = [
  {
    title: "Build or bring a deck",
    body: "Start blank, import a PowerPoint, PDF, Google Slides link or question sheet, or describe a topic and review the outline AI drafts for you.",
  },
  {
    title: "Go live with a join code",
    body: "Open the lobby and show the code or QR code. People join from their phones, no account needed, and answer as you present.",
  },
  {
    title: "Review and share",
    body: "Every run is saved as a session report. Export it, share a read-only results link, or run the deck again.",
  },
];

export function Steps() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className={`${sectionY} scroll-mt-20`}>
      <div className={container}>
        <SectionHeading
          id="how-title"
          title="Live in three steps"
          description="From a blank page to a room full of answers, usually in one sitting."
        />

        <ol className="mt-12 grid grid-cols-1 gap-10 md:mt-16 lg:grid-cols-3 lg:gap-12">
          {steps.map((step, i) => (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.6, ease, delay: i * 0.08 }}
              className="relative border-t border-foreground/15 pt-6"
            >
              <span
                aria-hidden="true"
                className="absolute -top-px left-0 h-px w-12 bg-brand-ink"
              />
              <span className="text-sm font-semibold text-brand-ink">Step {i + 1}</span>
              <h3 className="mt-3 text-2xl font-bold tracking-tight">{step.title}</h3>
              <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{step.body}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
