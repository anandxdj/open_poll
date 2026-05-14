"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, X, ChevronRight } from "lucide-react";

const faqs = [
  { q: "Is it really free?", a: "Yes, during our preview period, core features like poll creation and live voting are completely free." },
  { q: "Do voters need an account?", a: "No. Voters can participate instantly without signing up, keeping friction at zero." },
  { q: "How many questions can I add?", a: "You can stack as many questions as you need in a single poll link." },
];

export function FloatingFAQ() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="mb-4 w-80 overflow-hidden rounded-3xl border border-border bg-card shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between border-b border-border p-4 bg-secondary/30">
              <span className="text-sm font-bold">Quick FAQ</span>
              <button onClick={() => setIsOpen(false)} className="rounded-lg p-1 hover:bg-secondary transition-colors">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {faqs.map((f, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <ChevronRight className="size-3" />
                    {f.q}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-4.5">
                    {f.a}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-4 bg-secondary/10">
              <button className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
                View full documentation
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all duration-300"
      >
        {isOpen ? <X className="size-6" /> : <HelpCircle className="size-6" />}
      </button>
    </div>
  );
}
