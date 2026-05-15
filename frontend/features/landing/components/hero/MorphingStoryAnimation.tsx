"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Sparkles, MousePointer2, PieChart, CheckCircle2, Zap, Brain } from "lucide-react";

const phases = ["prompt", "expansion", "vote", "analytics"] as const;
type Phase = (typeof phases)[number];

const pollData = {
  question: "What should our next feature be?",
  options: [
    { id: 1, label: "Real-time Sync", weight: 45 },
    { id: 2, label: "AI Suggestions", weight: 32 },
    { id: 3, label: "Mobile App", weight: 23 },
  ]
};

const ease = [0.25, 1, 0.5, 1] as const;

export function MorphingStoryAnimation() {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [text, setText] = useState("");
  const [votes, setVotes] = useState([0, 0, 0]);
  const [cursor, setCursor] = useState<{ x: number, y: number, visible: boolean, clicking: boolean }>({ x: 50, y: 50, visible: false, clicking: false });

  useEffect(() => {
    const runCycle = async () => {
      // 1. PROMPT PHASE
      setPhase("prompt");
      setText("");
      setVotes([0, 0, 0]);
      setCursor({ x: 50, y: 50, visible: false, clicking: false });
      
      const fullText = pollData.question;
      for (let i = 0; i <= fullText.length; i++) {
        await new Promise((r) => setTimeout(r, 45));
        setText(fullText.slice(0, i));
      }
      await new Promise((r) => setTimeout(r, 1200));

      // 2. EXPANSION PHASE (Draft -> First Click)
      setPhase("expansion");
      await new Promise((r) => setTimeout(r, 600));

      // Move cursor to first option in the draft (Precisely hitting the first option box)
      setCursor({ x: 50, y: 72, visible: true, clicking: false });
      await new Promise((r) => setTimeout(r, 1200));
      
      // Click first option with a slight delay for impact
      setCursor(c => ({ ...c, clicking: true }));
      await new Promise((r) => setTimeout(r, 400));
      
      // 3. VOTE PHASE (Live Results)
      setPhase("vote");
      setCursor(c => ({ ...c, clicking: false, visible: false }));
      setVotes([45, 0, 0]);
      await new Promise((r) => setTimeout(r, 800));
      
      // Secondary votes fill in
      setVotes([45, 32, 23]);
      await new Promise((r) => setTimeout(r, 2500));

      // 4. ANALYICS PHASE
      setPhase("analytics");
      await new Promise((r) => setTimeout(r, 5000));

      runCycle();
    };

    runCycle();
  }, []);

  const totalVotes = votes.reduce((a, b) => a + b, 0);

  return (
    <div className="relative w-full max-w-lg mx-auto min-h-[460px] flex items-center justify-center">
      <AnimatePresence mode="wait">
        
        {/* CARD CONTAINER */}
        <motion.div
          key={phase}
          layout
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.6, ease }}
          className="w-full bg-background border border-border rounded-2xl shadow-xl shadow-foreground/5 p-8 overflow-hidden relative"
        >
          {/* Subtle Ambient Light (Theme aware) */}
          <div className="absolute top-0 right-0 size-32 bg-primary/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />

          {/* PHASE: PROMPT */}
          {phase === "prompt" && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="size-4 text-primary" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">AI Builder</span>
              </div>
              <div className="relative h-14 bg-secondary/30 rounded-xl flex items-center px-5 border border-border/50">
                <p className="text-base font-medium text-foreground/90">
                  {text}
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                    className="inline-block w-0.5 h-5 ml-1 bg-primary align-middle"
                  />
                </p>
              </div>
            </div>
          )}

          {/* PHASE: EXPANSION */}
          {phase === "expansion" && (
            <div className="space-y-8 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Zap className="size-4 text-primary" />
                  </div>
                  <span className="text-xs font-bold text-foreground/80">Draft Generated</span>
                </div>
                <div className="size-2 rounded-full bg-primary animate-pulse" />
              </div>
              
              <div className="space-y-4">
                <h3 className="text-xl font-bold tracking-tight text-foreground leading-tight">
                  {pollData.question}
                </h3>
                <div className="space-y-2">
                  {pollData.options.map((opt, i) => (
                    <motion.div
                      key={opt.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.15, ease }}
                      className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-secondary/20"
                    >
                      <div className="flex items-center gap-3">
                        <div className="size-6 rounded-md bg-background border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                          {i + 1}
                        </div>
                        <span className="text-sm font-medium text-foreground/70">{opt.label}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* MOUSE CURSOR (In Expansion phase now) */}
              <AnimatePresence>
                {cursor.visible && (
                  <motion.div
                    initial={{ opacity: 0, scale: 1.5, x: 0, y: 0 }}
                    animate={{ 
                      opacity: 1, 
                      scale: cursor.clicking ? 0.8 : 1,
                      left: `${cursor.x}%`,
                      top: `${cursor.y}%`
                    }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    className="absolute pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2"
                  >
                    <div className="relative">
                      <MousePointer2 className="size-7 text-foreground fill-primary drop-shadow-md" />
                      {cursor.clicking && (
                        <motion.div
                          initial={{ scale: 0, opacity: 1 }}
                          animate={{ scale: 2.5, opacity: 0 }}
                          className="absolute inset-0 size-7 rounded-full bg-primary/40 -z-10"
                        />
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* PHASE: VOTE */}
          {phase === "vote" && (
            <div className="space-y-8 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <div className="size-2 rounded-full bg-emerald-500" />
                  </div>
                  <span className="text-xs font-bold text-foreground/80">Live Results</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 border border-border">
                  <span className="text-[10px] font-black tabular-nums text-foreground/60">{totalVotes} votes</span>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-xl font-bold tracking-tight text-foreground leading-tight">
                  {pollData.question}
                </h3>
                <div className="space-y-4">
                  {pollData.options.map((opt, i) => {
                    const percentage = totalVotes === 0 ? 0 : Math.round((votes[i] / totalVotes) * 100);
                    return (
                      <div key={opt.id} className="relative group">
                        <div className="flex items-center justify-between text-sm font-bold mb-2.5 px-1">
                          <span className="text-foreground/70">{opt.label}</span>
                          <span className="text-primary tabular-nums text-xs">{percentage}%</span>
                        </div>
                        <div className="h-2.5 w-full bg-secondary rounded-full overflow-hidden relative">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ duration: 1, ease }}
                            className="h-full bg-primary rounded-full relative overflow-hidden"
                          >
                            <motion.div 
                              animate={{ x: ["-100%", "200%"] }}
                              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12"
                            />
                          </motion.div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* PHASE: ANALYTICS */}
          {phase === "analytics" && (
            <div className="space-y-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <PieChart className="size-4 text-primary" />
                  </div>
                  <span className="text-xs font-bold text-foreground/80">Final Analytics</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-500">
                  <CheckCircle2 className="size-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Report Ready</span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-center gap-12 py-4">
                {/* DONUT CHART */}
                <div className="relative size-40">
                  <svg className="size-full -rotate-90">
                    <circle
                      cx="80"
                      cy="80"
                      r="65"
                      fill="transparent"
                      stroke="currentColor"
                      strokeWidth="14"
                      className="text-secondary"
                    />
                    {/* Simplified segments for the animation */}
                    {pollData.options.map((opt, i) => {
                      const prevWeights = pollData.options.slice(0, i).reduce((acc, curr) => acc + curr.weight, 0);
                      const circumference = 2 * Math.PI * 65;
                      const offset = circumference - (opt.weight / 100) * circumference;
                      const rotation = (prevWeights / 100) * 360;

                      return (
                        <motion.circle
                          key={opt.id}
                          cx="80"
                          cy="80"
                          r="65"
                          fill="transparent"
                          stroke="currentColor"
                          strokeWidth="14"
                          strokeDasharray={circumference}
                          initial={{ strokeDashoffset: circumference }}
                          animate={{ strokeDashoffset: offset }}
                          transition={{ duration: 1.5, ease, delay: 0.2 + (i * 0.1) }}
                          style={{ 
                            transformOrigin: "center",
                            rotate: `${rotation}deg`
                          }}
                          className={i === 0 ? "text-primary" : (i === 1 ? "text-primary/60" : "text-primary/30")}
                          strokeLinecap="round"
                        />
                      );
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black text-foreground">{totalVotes}</span>
                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Total</span>
                  </div>
                </div>

                {/* LEGEND */}
                <div className="space-y-4">
                  {pollData.options.map((opt, i) => (
                    <motion.div
                      key={opt.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.8 + (i * 0.1) }}
                      className="flex items-center gap-3"
                    >
                      <div className={`size-3 rounded-full ${i === 0 ? "bg-primary" : (i === 1 ? "bg-primary/60" : "bg-primary/30")}`} />
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-foreground/80">{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground">{opt.weight}% frequency</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-border flex justify-center">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.5 }}
                  className="flex items-center gap-2 text-primary"
                >
                  <Brain className="size-4" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Synthesizing Insights...</span>
                </motion.div>
              </div>
            </div>
          )}

        </motion.div>
      </AnimatePresence>
    </div>
  );
}
