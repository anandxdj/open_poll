"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Zap, Brain, Check } from "lucide-react";

const mockQuestions = [
  "Which flavor best describes our company culture?",
  "What is the one thing we should change in our next sprint?",
  "Who is most likely to survive a zombie apocalypse in this office?",
];

export function LiveAiMockup() {
  const [step, setStep] = useState(0); // 0: idle, 1: typing, 2: generating, 3: result
  const [displayText, setDisplayText] = useState("");
  const fullText = "Create a fun team-building poll about office culture...";

  useEffect(() => {
    if (step === 0) {
      const timer = setTimeout(() => setStep(1), 2000);
      return () => clearTimeout(timer);
    }

    if (step === 1) {
      if (displayText.length < fullText.length) {
        const timer = setTimeout(() => {
          setDisplayText(fullText.slice(0, displayText.length + 1));
        }, 40);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => setStep(2), 800);
        return () => clearTimeout(timer);
      }
    }

    if (step === 2) {
      const timer = setTimeout(() => setStep(3), 2500);
      return () => clearTimeout(timer);
    }

    if (step === 3) {
      const timer = setTimeout(() => {
        setStep(0);
        setDisplayText("");
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [step, displayText]);

  return (
    <div className="relative mt-20 mx-auto max-w-3xl">
      {/* Glow under card */}
      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-24 bg-primary/20 blur-[100px] rounded-full opacity-50" />

      {/* Mock dashboard card */}
      <div className="relative rounded-[2.5rem] border border-border bg-card dark:bg-[#0a0a0a] p-4 shadow-2xl overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] to-transparent pointer-events-none" />
        
        <div className="rounded-[1.75rem] bg-background/50 overflow-hidden border border-border dark:border-white/5 backdrop-blur-sm">
          {/* Mock topbar */}
          <div className="flex items-center justify-between border-b border-border dark:border-white/5 px-6 py-4 bg-foreground/[0.02]">
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <Zap className="size-4 text-primary-foreground fill-primary-foreground" />
              </div>
              <span className="text-sm font-bold tracking-tight">Open Poll Builder</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-12 rounded-full bg-foreground/5 dark:bg-white/5" />
              <div className="h-8 w-24 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                 <span className="text-[10px] font-bold text-primary uppercase tracking-widest">AI Core</span>
              </div>
            </div>
          </div>

          {/* Mock content */}
          <div className="p-8 space-y-6">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/5 blur-xl rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
              <div className="relative rounded-2xl border border-border dark:border-white/10 bg-foreground/[0.02] p-6 space-y-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Brain className="size-3.5 text-primary" />
                  AI Prompt
                </div>
                <div className="min-h-12 text-sm text-foreground/90 font-medium leading-relaxed italic">
                  {displayText}
                  {step === 1 && <span className="inline-block w-1 h-4 ml-1 bg-primary animate-pulse" />}
                  {step === 0 && <span className="text-muted-foreground/30 italic">Describe your poll...</span>}
                </div>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {step === 2 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  className="flex flex-col items-center justify-center py-10 space-y-4"
                >
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse" />
                    <div className="relative size-16 rounded-full border border-primary/30 flex items-center justify-center bg-primary/10">
                      <Sparkles className="size-8 text-primary animate-spin-slow" />
                    </div>
                  </div>
                  <div className="space-y-1 text-center">
                    <p className="text-sm font-bold tracking-tight">Generating magic...</p>
                    <p className="text-xs text-muted-foreground">Curating high-engagement questions</p>
                  </div>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">Proposed Draft</p>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
                       <Check className="size-3 text-primary" />
                       <span className="text-[10px] font-bold text-primary uppercase">Draft Ready</span>
                    </div>
                  </div>
                  {mockQuestions.map((q, i) => (
                    <motion.div
                      key={q}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1, duration: 0.4 }}
                      className="group/q relative rounded-xl border border-border dark:border-white/5 bg-foreground/[0.03] p-4 flex items-center gap-4 hover:border-primary/30 transition-all duration-300"
                    >
                      <div className="size-6 rounded-lg bg-foreground/5 dark:bg-white/5 flex items-center justify-center text-[10px] font-bold text-muted-foreground group-hover/q:bg-primary/20 group-hover/q:text-primary transition-colors">
                        {i + 1}
                      </div>
                      <p className="text-sm font-medium text-foreground/80">{q}</p>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
