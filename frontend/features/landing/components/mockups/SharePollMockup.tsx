"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, Link2, Check, QrCode, Globe, Code, Mail, MessageSquare } from "lucide-react";

export function SharePollMockup() {
  const [step, setStep] = useState(0); // 0: typing url, 1: url ready, 2: link copied, 3: distribution grid
  const shareLink = "openpoll.com/p/team-culture-2026";

  useEffect(() => {
    const cycle = async () => {
      setStep(0);
      await new Promise((r) => setTimeout(r, 2000));
      
      setStep(1); // URL ready
      await new Promise((r) => setTimeout(r, 1500));
      
      setStep(2); // Link copied automatically/programmatically
      await new Promise((r) => setTimeout(r, 2000));
      
      setStep(3); // Distribution icons pulse
      await new Promise((r) => setTimeout(r, 4000));
      
      cycle();
    };
    cycle();
  }, []);

  return (
    <div className="relative w-full max-w-lg mx-auto py-12 perspective-2000">
      {/* Ambient Glow */}
      <motion.div 
        animate={{ 
          opacity: [0.1, 0.2, 0.1],
          scale: [1, 1.2, 1]
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 bg-primary/10 blur-[100px] rounded-full pointer-events-none" 
      />

      {/* Mock Card */}
      <div className="relative rounded-[2.5rem] border border-border bg-card/80 dark:bg-[#0a0a0a]/80 backdrop-blur-3xl p-8 shadow-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.05] to-transparent pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Share2 className="size-5 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-bold tracking-tight">Distribution Engine</h4>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">Link Generator Active</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
             <div className="size-1.5 rounded-full bg-primary animate-pulse" />
             <span className="text-[9px] font-bold text-primary uppercase tracking-tight">Ready</span>
          </div>
        </div>

        {/* Animation Content */}
        <div className="space-y-8">
          {/* URL Bar */}
          <div className="relative">
            <div className="absolute inset-0 bg-primary/5 blur-xl rounded-2xl opacity-100 transition-opacity" />
            <div className="relative rounded-2xl border border-border bg-foreground/[0.02] p-5 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Permanent Poll URL</span>
                <Globe className="size-3 text-primary/40" />
              </div>
              <div className="relative flex items-center bg-background/50 border border-border/50 rounded-xl px-4 py-3.5 overflow-hidden">
                <Link2 className="size-4 text-primary shrink-0 mr-3" />
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium text-foreground/80 truncate font-mono">
                    {step >= 1 ? shareLink : "Generating unique link..."}
                  </p>
                </div>
                
                <AnimatePresence>
                  {step === 2 && (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="absolute right-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-[10px] font-bold uppercase shadow-lg shadow-primary/20"
                    >
                      <Check className="size-3" />
                      Copied
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              
              {/* Scanline effect over URL bar when generating */}
              {step === 0 && (
                <motion.div 
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent pointer-events-none"
                />
              )}
            </div>
          </div>

          {/* Distribution Grid */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: QrCode, label: "QR" },
              { icon: Code, label: "Embed" },
              { icon: Mail, label: "Email" },
              { icon: MessageSquare, label: "Chat" }
            ].map((item, i) => (
              <motion.div 
                key={i}
                animate={step === 3 ? {
                  borderColor: ["var(--border)", "var(--primary)", "var(--border)"],
                  backgroundColor: ["rgba(216, 173, 135, 0)", "var(--primary-10, rgba(216, 173, 135, 0.05))", "rgba(216, 173, 135, 0)"],
                  scale: [1, 1.05, 1]
                } : {}}
                transition={{ duration: 2, delay: i * 0.2, repeat: Infinity }}
                className="rounded-xl border border-border bg-foreground/[0.02] p-4 flex flex-col items-center justify-center gap-2 group transition-all"
              >
                 <item.icon className={cn(
                   "size-5 transition-colors duration-500",
                   step === 3 ? "text-primary" : "text-muted-foreground/40"
                 )} />
                 <span className={cn(
                   "text-[9px] font-bold uppercase tracking-widest transition-colors duration-500",
                   step === 3 ? "text-foreground" : "text-muted-foreground/30"
                 )}>{item.label}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-border flex items-center justify-between text-[9px] font-bold text-muted-foreground/30 uppercase tracking-[0.2em]">
           <div className="flex items-center gap-2">
              <div className="size-1 rounded-full bg-primary" />
              <span>Multi-channel Ready</span>
           </div>
           <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <motion.div 
                  key={i}
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ duration: 2, delay: i * 0.3, repeat: Infinity }}
                  className="size-1 rounded-full bg-primary" 
                />
              ))}
           </div>
        </div>
      </div>
    </div>
  );
}

// Helper to use cn in this file if needed, though it's usually imported
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
