"use client";

import { motion } from "framer-motion";

interface StatementRating {
  statement: string;
  average: number;
  count: number;
}

interface ScalesSpectrumProps {
  statements: StatementRating[];
  scaleMax: number;
  minLabel?: string;
  maxLabel?: string;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function ScalesSpectrum({
  statements,
  scaleMax,
  minLabel,
  maxLabel,
}: ScalesSpectrumProps) {
  if (!statements || statements.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-white/40 font-medium">
        Waiting for scale ratings…
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">
      {statements.map((s, i) => {
        const pct = Math.round((s.average / scaleMax) * 100);

        return (
          <div key={i} className="space-y-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white/90 truncate">{s.statement}</span>
              <span className="text-xs font-mono font-bold text-amber-400 shrink-0">
                {s.average.toFixed(1)} <span className="text-white/40 font-normal">/ {scaleMax}</span>
              </span>
            </div>

            <div className="h-3 rounded-full bg-white/5 overflow-hidden p-0.5 border border-white/5">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 shadow-[0_0_10px_rgba(245,158,11,0.4)]"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease }}
              />
            </div>

            {(minLabel || maxLabel) && (
              <div className="flex justify-between text-[10px] font-medium text-white/40 pt-0.5">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
