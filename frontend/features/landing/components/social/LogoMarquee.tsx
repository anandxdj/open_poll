"use client";

import { motion } from "framer-motion";

const logos = [
  "Acme Corp",
  "Globex",
  "Soylent Corp",
  "Initech",
  "Umbrella",
  "Wonka",
  "Stark Ind",
  "Wayne Ent",
];

export function LogoMarquee() {
  return (
    <section className="py-20 border-y border-border/50 bg-secondary/5 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 mb-10 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/50">
          Trusted by modern teams everywhere
        </p>
      </div>
      
      <div className="relative flex overflow-hidden">
        <motion.div
          animate={{ x: [0, -1000] }}
          transition={{
            duration: 30,
            repeat: Infinity,
            ease: "linear",
          }}
          className="flex gap-20 whitespace-nowrap px-10"
        >
          {[...logos, ...logos, ...logos].map((logo, i) => (
            <span
              key={i}
              className="text-2xl font-bold text-muted-foreground/20 hover:text-primary/40 transition-colors duration-500 cursor-default"
            >
              {logo}
            </span>
          ))}
        </motion.div>
        
        {/* Gradients to fade out edges */}
        <div className="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-background to-transparent z-10" />
        <div className="absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-background to-transparent z-10" />
      </div>
    </section>
  );
}
