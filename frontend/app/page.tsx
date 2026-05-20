"use client";

import { 
  Hero, 
  Navbar, 
  BentoGrid, 
  Steps, 
   
  LogoMarquee, 
  Footer, 
  FloatingFAQ,
  ShowcaseSections,
  Pricing
} from "@/features/landing";

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-radial-glow text-foreground selection:bg-primary/30 selection:text-foreground">
      <Navbar />
      
      <main>
        {/* Hero Section */}
        <Hero />

        {/* Social Proof */}
        <LogoMarquee />

        {/* Workflow Section (The Simple Path) */}
        <Steps />

        {/* Feature Showcase (The Magic in Action) */}
        <ShowcaseSections />

        {/* Features Grid (Under the Hood Engine) */}
        <BentoGrid />

        {/* Pricing Section */}
        <Pricing />
       
      </main>

      <Footer />
      <FloatingFAQ />
    </div>
  );
}
