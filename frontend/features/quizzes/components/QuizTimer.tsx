"use client";

import { Timer } from "lucide-react";

interface QuizTimerProps {
  secondsLeft: number;
  progress: number; // 1 → full time remaining, 0 → expired
}

export function QuizTimer({ secondsLeft, progress }: QuizTimerProps) {
  const urgent = progress <= 0.25;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
          <Timer className="size-3" /> Time left
        </span>
        <span
          className={`text-2xl font-bold tabular-nums tracking-tight ${
            urgent ? "text-red-400 animate-pulse" : "text-primary"
          }`}
        >
          {secondsLeft}s
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/5 border border-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
            urgent ? "bg-red-400" : "bg-primary"
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
