"use client";

import { 
  Hero, 
  Navbar, 
  BentoGrid, 
  Steps, 
  CallToAction, 
  LogoMarquee, 
  Footer, 
  FloatingFAQ,
  LiveAiMockup
} from "@/features/landing";

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-radial-glow text-foreground selection:bg-primary/30 selection:text-foreground">
      <Navbar />
      
      <main>
        {/* Hero Section */}
        <div className="relative">
          <Hero />
          {/* Centerpiece Interactive Mockup */}
          <div className="pb-32 px-6">
            <LiveAiMockup />
          </div>
        </div>

        {/* Social Proof */}
        <LogoMarquee />

        {/* Features Section */}
        <BentoGrid />

        {/* Workflow Section */}
        <Steps />

        {/* Pricing Anchor */}
        <section id="pricing" className="border-t border-border px-6 py-24 bg-secondary/[0.01]">
          <div className="mx-auto max-w-2xl text-center space-y-4">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance text-foreground/90">
              Pricing during preview
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground text-pretty leading-relaxed">
              Core creation, voting, and analytics stay free while we ship the rest of the roadmap.
              Paid tiers will arrive later with clear limits and exports.
            </p>
          </div>
        </section>

        {/* Final CTA */}
        <CallToAction />
      </main>

      <Footer />
      <FloatingFAQ />
    </div>
  );
}
