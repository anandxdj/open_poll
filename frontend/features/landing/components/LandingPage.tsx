"use client";

import { MotionConfig } from "framer-motion";
import { FinalCta } from "./cta/FinalCta";
import { Faq } from "./faq/Faq";
import { Capabilities } from "./features/Capabilities";
import { QuestionTypes } from "./features/QuestionTypes";
import { ShowcaseSections } from "./features/ShowcaseSections";
import { Steps } from "./features/Steps";
import { Hero } from "./hero/Hero";
import { Navbar } from "./hero/Navbar";
import { Pricing } from "./pricing/Pricing";
import { Footer } from "./social/Footer";

/** The marketing page at `/`; `app/page.tsx` adds its metadata and structured data. */
export function LandingPage() {
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
