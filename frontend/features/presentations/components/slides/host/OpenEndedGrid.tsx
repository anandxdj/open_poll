"use client";

import { motion } from "framer-motion";

interface ResponseItem {
  text: string;
  count: number;
}

interface OpenEndedGridProps {
  responses: ResponseItem[];
}

export function OpenEndedGrid({ responses }: OpenEndedGridProps) {
  if (!responses || responses.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-white/40 font-medium">
        Waiting for open thoughts from participants…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-h-[360px] overflow-y-auto p-1">
      {responses.map((r, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.04 }}
          className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left shadow-sm backdrop-blur-sm hover:border-white/20 transition-all"
        >
          <p className="text-sm font-semibold text-white/90 leading-relaxed break-words">
            &ldquo;{r.text}&rdquo;
          </p>
          {r.count > 1 && (
            <span className="absolute top-3 right-3 rounded-full bg-amber-400/15 border border-amber-400/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              ×{r.count}
            </span>
          )}
        </motion.div>
      ))}
    </div>
  );
}
