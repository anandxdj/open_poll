"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart2, Clock, Globe, Lock } from "lucide-react";
import { motion } from "framer-motion";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PollCardGlass({ poll }: { poll: Poll }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  const isExpired = (now > 0 && new Date(poll.expiresAt).getTime() <= now) || poll.isClosed;
  const isDraft = !poll.isPublished;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className={cn(
        "relative group overflow-hidden border-0 rounded-[2rem] p-6 h-full transition-all duration-500",
        "bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950",
        "shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]",
        "hover:shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_20px_50px_rgba(0,0,0,0.4)]"
      )}>
        {/* Glow effect on hover */}
        <div className="absolute -inset-px bg-gradient-to-r from-blue-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />

        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center justify-between mb-6">
            <div className={cn(
              "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium backdrop-blur-md",
              isExpired ? "bg-zinc-200/50 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400" : 
              isDraft ? "bg-amber-100/50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" :
              "bg-blue-100/50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
            )}>
              {poll.isAnonymous ? <Lock className="size-3" /> : <Globe className="size-3" />}
              {isExpired ? "Archived" : isDraft ? "Drafting" : "Active"}
            </div>
            
            <div className="text-zinc-400 text-[10px] flex items-center gap-1">
              <Clock className="size-3" />
              {isExpired ? "Ended" : "2 days left"}
            </div>
          </div>

          <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mb-4 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2 leading-snug">
            {poll.title}
          </h3>

          <div className="mt-auto">
            <div className="flex items-center justify-between py-4 border-t border-zinc-100 dark:border-zinc-800/50">
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {poll.questions.length}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Questions</span>
              </div>
              
              <Link 
                href={`/analytics/${poll._id}`}
                className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold hover:gap-3 transition-all active:scale-95 shadow-lg shadow-zinc-200 dark:shadow-none"
              >
                Insights
                <BarChart2 className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
