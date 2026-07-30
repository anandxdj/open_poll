"use client";

import { motion } from "framer-motion";

interface WordItem {
  text: string;
  count: number;
}

interface WordCloudCanvasProps {
  words: WordItem[];
  showCounts?: boolean;
}

const colorVariants = [
  "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  "text-amber-300 border-amber-300/30 bg-amber-300/10",
  "text-orange-400 border-orange-400/30 bg-orange-400/10",
  "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  "text-sky-400 border-sky-400/30 bg-sky-400/10",
  "text-purple-400 border-purple-400/30 bg-purple-400/10",
];

export function WordCloudCanvas({ words, showCounts = true }: WordCloudCanvasProps) {
  if (!words || words.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-white/40 font-medium">
        Waiting for words from participants…
      </div>
    );
  }

  const maxCount = Math.max(...words.map((w) => w.count), 1);
  const minCount = Math.min(...words.map((w) => w.count), 1);

  return (
    <div className="flex flex-wrap gap-3 justify-center items-center p-4 max-w-xl mx-auto">
      {words.map((w, i) => {
        // Calculate font size multiplier based on relative count
        const norm = maxCount === minCount ? 0.5 : (w.count - minCount) / (maxCount - minCount);
        const fontSizeRem = 0.85 + norm * 1.35; // ranges from 0.85rem to 2.2rem
        const colorClass = colorVariants[i % colorVariants.length];

        return (
          <motion.span
            key={w.text}
            layout
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            style={{ fontSize: `${fontSizeRem}rem` }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 font-black tracking-tight shadow-sm ${colorClass}`}
          >
            {w.text}
            {showCounts && w.count > 1 && (
              <span className="text-[0.65em] opacity-75 font-mono">×{w.count}</span>
            )}
          </motion.span>
        );
      })}
    </div>
  );
}
