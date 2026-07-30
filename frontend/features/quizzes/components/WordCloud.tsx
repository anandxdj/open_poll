"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Word {
  text: string;
  count: number;
}

interface WordCloudProps {
  words: Word[];
  /** Show count superscript on each word (host view context) */
  showCounts?: boolean;
}

interface PlacedWord extends Word {
  x: number;
  y: number;
  rotate: number;
  fontSize: number;
  colorClass: string;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const PALETTE = [
  "text-sky-400",
  "text-emerald-400",
  "text-yellow-400",
  "text-orange-400",
  "text-rose-400",
  "text-purple-400",
  "text-cyan-400",
  "text-violet-400",
  "text-fuchsia-400",
  "text-lime-400",
  "text-amber-300",
  "text-teal-300",
];

/** Stable pseudo-random 0..1 from a string seed (FNV-1a) — no jitter on re-render. */
function seededRand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function checkCollision(box: Box, placed: Box[]): boolean {
  const margin = 3;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (
      box.left - margin < p.right + margin &&
      box.right + margin > p.left - margin &&
      box.top - margin < p.bottom + margin &&
      box.bottom + margin > p.top - margin
    ) {
      return true;
    }
  }
  return false;
}

export function WordCloud({ words, showCounts = false }: WordCloudProps) {
  const placedWords = useMemo(() => {
    if (!words || words.length === 0) return [];

    // Sort highest frequency first so primary words cluster in the center
    const sorted = [...words].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
    const maxCount = Math.max(...sorted.map((w) => w.count), 1);
    const minCount = Math.min(...sorted.map((w) => w.count), 1);

    const placedBoxes: Box[] = [];
    const result: PlacedWord[] = [];

    // Scale font size range dynamically depending on number of items
    const baseMinPx = sorted.length > 35 ? 13 : sorted.length > 20 ? 15 : 18;
    const baseMaxPx = sorted.length > 35 ? 46 : sorted.length > 20 ? 56 : 68;

    for (let idx = 0; idx < sorted.length; idx++) {
      const word = sorted[idx];
      const randVal = seededRand(word.text);
      const randRot = seededRand(word.text + "_rot");
      const randCol = seededRand(word.text + "_col");

      // Sqrt scaling for balanced hierarchy between top & lower frequency words
      const norm = maxCount === minCount ? 0.5 : Math.sqrt((word.count - minCount) / (maxCount - minCount || 1));
      const fontSize = Math.round(baseMinPx + norm * (baseMaxPx - baseMinPx));

      // Mentimeter style: ~55% horizontal (0°), ~45% vertical (-90° or 90°)
      let rotate = 0;
      if (randVal > 0.55) {
        rotate = randRot > 0.5 ? 90 : -90;
      }

      const isVertical = rotate !== 0;
      const unrotatedWidth = word.text.length * fontSize * 0.58 + 8;
      const unrotatedHeight = fontSize * 1.1 + 4;

      const boxW = isVertical ? unrotatedHeight : unrotatedWidth;
      const boxH = isVertical ? unrotatedWidth : unrotatedHeight;

      let finalX = 0;
      let finalY = 0;
      let placed = false;

      // Archimedean spiral search
      const maxSteps = 1600;
      const a = 4.5; // radius step coefficient
      const stepAngle = 0.18; // theta increment

      for (let step = 0; step < maxSteps; step++) {
        const theta = step * stepAngle;
        const radius = a * theta;
        // Aspect ratio correction (1.35:1) for rectangular containers
        const cx = radius * Math.cos(theta) * 1.35;
        const cy = radius * Math.sin(theta);

        const candidateBox: Box = {
          left: cx - boxW / 2,
          top: cy - boxH / 2,
          right: cx + boxW / 2,
          bottom: cy + boxH / 2,
        };

        if (!checkCollision(candidateBox, placedBoxes)) {
          placedBoxes.push(candidateBox);
          finalX = cx;
          finalY = cy;
          placed = true;
          break;
        }
      }

      if (!placed) {
        finalX = (randVal - 0.5) * 300;
        finalY = (randRot - 0.5) * 200;
      }

      const colorClass = PALETTE[Math.floor(randCol * PALETTE.length)];

      result.push({
        ...word,
        x: Math.round(finalX),
        y: Math.round(finalY),
        rotate,
        fontSize,
        colorClass,
      });
    }

    return result;
  }, [words]);

  if (!words || words.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground/50 py-12">
        Waiting for responses…
      </p>
    );
  }

  return (
    <div className="relative w-full max-w-4xl h-[320px] sm:h-[380px] md:h-[420px] max-h-[52vh] mx-auto flex items-center justify-center overflow-hidden select-none py-2">
      <AnimatePresence mode="popLayout">
        {placedWords.map((word) => (
          <motion.span
            key={word.text}
            layout
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: 1,
              opacity: 1,
              x: word.x,
              y: word.y,
              rotate: word.rotate,
            }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 280,
              damping: 24,
            }}
            style={{
              position: "absolute",
              fontSize: `${word.fontSize}px`,
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
            className={`font-black tracking-tight cursor-default drop-shadow-md select-none ${word.colorClass}`}
            title={showCounts ? `×${word.count}` : undefined}
          >
            {word.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

