"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Zap, Users, Trophy } from "lucide-react";

const initialOptions = [
  { id: 1, label: "Real-time updates", votes: 124 },
  { id: 2, label: "AI-powered builder", votes: 98 },
  { id: 3, label: "Mobile-first design", votes: 45 },
];

export function LivePollAnimation() {
  const [votes, setVotes] = useState(initialOptions.map(o => o.votes));
  const [activeIndices, setActiveIndices] = useState<number[]>([]);
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    // 20-second master cycle
    const masterInterval = setInterval(() => {
      setTimer(prev => {
        if (prev >= 19) {
          setVotes(initialOptions.map(o => o.votes));
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    // Steady 2-second voting interval
    const voteInterval = setInterval(() => {
      if (timer < 18) {
        const numToUpdate = Math.random() > 0.6 ? 2 : 1;
        const indices = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, numToUpdate);
        
        setVotes(prev => {
          const next = [...prev];
          indices.forEach(idx => {
            next[idx] += Math.floor(Math.random() * 4) + 2;
          });
          return next;
        });
        
        setActiveIndices(indices);
        setTimeout(() => setActiveIndices([]), 1200);
      }
    }, 2000);

    return () => {
      clearInterval(masterInterval);
      clearInterval(voteInterval);
    };
  }, [timer]);

  const totalVotes = votes.reduce((a, b) => a + b, 0);
  const leadingIdx = votes.indexOf(Math.max(...votes));

  return (
    <div className="relative w-full max-w-lg mx-auto py-12 perspective-2000">
      {/* Soft Ambient Glow */}
      <motion.div 
        animate={{ 
          opacity: [0.2, 0.4, 0.2],
          scale: [1, 1.1, 1]
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 bg-primary/10 blur-[120px] rounded-full pointer-events-none" 
      />
      
      {/* Production-Grade Card */}
      <div className="relative rounded-[3rem] border border-border bg-card/80 dark:bg-[#0a0a0a]/80 backdrop-blur-3xl p-10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] dark:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* Subtle glass highlight */}
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.03] dark:from-white/[0.05] via-transparent to-transparent pointer-events-none" />
        
        {/* Header Section */}
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/5">
              <Zap className="size-6 text-primary fill-primary/20" />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-bold tracking-tight text-foreground/90">Live Pulse</h4>
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full size-2 bg-primary"></span>
                </span>
                <span className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.1em]">
                  {timer < 18 ? "Receiving Votes" : "Cycle Refresh"}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <motion.div 
              key={totalVotes}
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl font-black tabular-nums tracking-tighter text-foreground"
            >
              {totalVotes}
            </motion.div>
            <div className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">Total Energy</div>
          </div>
        </div>

        {/* Poll Options */}
        <div className="space-y-10">
          {initialOptions.map((option, index) => {
            const percentage = Math.round((votes[index] / totalVotes) * 100);
            const isLeading = index === leadingIdx;
            const isUpdating = activeIndices.includes(index);

            return (
              <motion.div 
                key={option.id}
                animate={{ 
                  scale: isUpdating ? 1.02 : 1,
                  opacity: timer >= 18 ? 0.6 : 1
                }}
                className="relative"
              >
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-sm font-bold transition-colors duration-500 ${isLeading ? "text-foreground" : "text-muted-foreground/60"}`}>
                      {option.label}
                    </span>
                    {isLeading && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="size-4 rounded-full bg-primary/20 flex items-center justify-center"
                      >
                        <Trophy className="size-2.5 text-primary" />
                      </motion.div>
                    )}
                  </div>
                  <span className="text-xs font-black tabular-nums text-muted-foreground/30">{percentage}%</span>
                </div>

                <div className="relative h-4 w-full rounded-full bg-foreground/[0.03] overflow-hidden border border-border/50 p-1">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ 
                      width: `${percentage}%`,
                    }}
                    transition={{ 
                      width: { duration: 1.2, ease: [0.32, 0.72, 0, 1] },
                    }}
                    className="h-full rounded-full relative overflow-hidden bg-primary"
                  >
                    {/* Animated shine */}
                    <motion.div
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12"
                    />
                  </motion.div>
                  
                  {/* Ripple on update */}
                  <AnimatePresence>
                    {isUpdating && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-primary/20 rounded-full blur-md"
                      />
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footer Stats */}
        <div className="mt-12 pt-8 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30">
            <div className="flex items-center gap-2">
              <Users className="size-3" />
              <span>Real-time</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-1 rounded-full bg-primary animate-pulse" />
              <span>Feed Active</span>
            </div>
          </div>
          <div className="w-24 h-1 bg-secondary rounded-full overflow-hidden">
             <motion.div 
               animate={{ width: `${(timer / 20) * 100}%` }}
               transition={{ duration: 1, ease: "linear" }}
               className="h-full bg-primary/40"
             />
          </div>
        </div>
      </div>
    </div>
  );
}
