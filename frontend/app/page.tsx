"use client";

import { MotionConfig } from "framer-motion";
import {
  Capabilities,
  Faq,
  FinalCta,
  Footer,
  Hero,
  Navbar,
  Pricing,
  QuestionTypes,
  ShowcaseSections,
  Steps,
} from "@/features/landing";

export default function LandingPage() {
  return (
    // reducedMotion="user": framer-motion skips transform animations for people who ask for less motion.
    <MotionConfig reducedMotion="user">
      <div className="mk-surface relative min-h-dvh overflow-x-clip bg-background text-foreground">
        <a href="#main" className="mk-skip-link">
          Skip to content
        </a>
        <Navbar />

        <main id="main">
          <Hero />
          <QuestionTypes />
          <Steps />
          <ShowcaseSections />
          <Capabilities />
          <Pricing />
          <Faq />
          <FinalCta />
        </main>

        <Footer />
      </div>
    </MotionConfig>
  );
}
