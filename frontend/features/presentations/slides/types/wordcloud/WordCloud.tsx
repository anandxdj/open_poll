"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Word {
  text: string;
  count: number;
}

interface WordCloudProps {
  words: Word[];
  /** Show count superscript on each word (host view context) */
  showCounts?: boolean;
  /** Replaces the default size of the cloud's box (the landing sample draws it in its own box). */
  className?: string;
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

/** A word's ink (its glyphs, not its line box) and where that ink sits relative to the line box centre. */
interface Ink {
  width: number;
  height: number;
  dx: number;
  dy: number;
}

type Measure = (text: string, fontSize: number) => Ink;

// Deck theme cloud colours (theme/tokens.css), full class names so Tailwind
// generates them.
const PALETTE = [
  "text-deck-cloud-1",
  "text-deck-cloud-2",
  "text-deck-cloud-3",
  "text-deck-cloud-4",
  "text-deck-cloud-5",
  "text-deck-cloud-6",
  "text-deck-cloud-7",
  "text-deck-cloud-8",
  "text-deck-cloud-9",
  "text-deck-cloud-10",
  "text-deck-cloud-11",
  "text-deck-cloud-12",
];

/** Font sizes before the cloud is scaled to fit its box. */
const MIN_PX = 14;
const MAX_PX = 76;
/** Space kept around a word's ink, as a share of its font size (wider across, so neighbours never read as one word). */
const PAD_X = 0.1;
const PAD_Y = 0.04;
/** How far a sparse cloud may grow to fill its box. */
const MAX_SCALE = 1.5;
/** `tracking-tight`, in em. */
const TRACKING = -0.025;

const SPRING = { type: "spring", stiffness: 280, damping: 26 } as const;

/** Stable pseudo-random 0..1 from a string seed (FNV-1a) — no jitter on re-render. */
function seededRand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function overlaps(box: Box, placed: Box[]): boolean {
  for (const p of placed) {
    if (box.left < p.right && box.right > p.left && box.top < p.bottom && box.bottom > p.top) return true;
  }
  return false;
}

/** Measures glyph bounds on a canvas in the cloud's own font, so words pack by their ink. */
function canvasMeasure(fontFamily: string): Measure {
  const ctx = document.createElement("canvas").getContext("2d");
  return (text, fontSize) => {
    const track = TRACKING * fontSize;
    if (!ctx) return { width: text.length * fontSize * 0.58, height: fontSize, dx: 0, dy: 0 };
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    const m = ctx.measureText(text);
    // Letter spacing follows every glyph, so the last glyph starts that much
    // earlier than the canvas (which draws without it) puts it.
    const left = -m.actualBoundingBoxLeft;
    const right = m.actualBoundingBoxRight + track * (text.length - 1);
    const lineWidth = m.width + track * text.length;
    // Line height is 1: the baseline sits half the leftover leading plus the
    // font's ascent below the top of the line box.
    const ascent = m.fontBoundingBoxAscent ?? fontSize * 0.97;
    const descent = m.fontBoundingBoxDescent ?? fontSize * 0.24;
    const baseline = (fontSize - ascent - descent) / 2 + ascent;
    const top = baseline - m.actualBoundingBoxAscent;
    const bottom = baseline + m.actualBoundingBoxDescent;
    return {
      width: right - left,
      height: bottom - top,
      dx: (left + right) / 2 - lineWidth / 2,
      dy: (top + bottom) / 2 - fontSize / 2,
    };
  };
}

/**
 * Places the most frequent words first, each at the first free spot on an
 * Archimedean spiral stretched to the box's aspect ratio, so the cloud grows
 * outward from its biggest word. Returns positions centred on the cloud and
 * the cloud's size.
 */
function layoutCloud(words: Word[], measure: Measure, aspect: number) {
  const sorted = [...words].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  const maxCount = sorted[0].count;
  const minCount = sorted[sorted.length - 1].count;

  const boxes: Box[] = [];
  const placed: PlacedWord[] = [];

  sorted.forEach((word) => {
    const randVal = seededRand(word.text);
    const randRot = seededRand(word.text + "_rot");
    const randCol = seededRand(word.text + "_col");

    const norm = maxCount === minCount ? 0.5 : Math.pow((word.count - minCount) / (maxCount - minCount), 0.75);
    const fontSize = Math.round(MIN_PX + norm * (MAX_PX - MIN_PX));

    // Mentimeter style: the big words read across, ~40% of the smaller ones run vertically.
    const rotate = norm < 0.5 && randVal > 0.6 ? (randRot > 0.5 ? 90 : -90) : 0;
    const ink = measure(word.text, fontSize);
    const padX = fontSize * PAD_X + 1;
    const padY = fontSize * PAD_Y + 1;
    const w = (rotate ? ink.height + 2 * padY : ink.width + 2 * padX) / 2;
    const h = (rotate ? ink.width + 2 * padX : ink.height + 2 * padY) / 2;

    // Steps of about 3px along the spiral, from a seeded starting angle.
    const phase = randRot * Math.PI * 2;
    let t = 0;
    for (let step = 0; step < 12000; step++) {
      const radius = 1.6 * t;
      const cx = radius * Math.cos(t + phase) * aspect;
      const cy = radius * Math.sin(t + phase);
      const box = { left: cx - w, top: cy - h, right: cx + w, bottom: cy + h };
      if (!overlaps(box, boxes)) {
        boxes.push(box);
        // Place the span so its ink, not its line box, lands on the spot.
        const ox = rotate ? -Math.sign(rotate) * ink.dy : ink.dx;
        const oy = rotate ? Math.sign(rotate) * ink.dx : ink.dy;
        placed.push({
          ...word,
          x: cx - ox,
          y: cy - oy,
          rotate,
          fontSize,
          colorClass: PALETTE[Math.floor(randCol * PALETTE.length)],
        });
        return;
      }
      t += Math.min(0.3, 3 / (radius * aspect + 1));
    }
  });

  const left = Math.min(...boxes.map((b) => b.left));
  const right = Math.max(...boxes.map((b) => b.right));
  const top = Math.min(...boxes.map((b) => b.top));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  return {
    words: placed.map((p) => ({ ...p, x: Math.round(p.x - midX), y: Math.round(p.y - midY) })),
    width: right - left,
    height: bottom - top,
  };
}

export function WordCloud({ words, showCounts = false, className }: WordCloudProps) {
  const root = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number; font: string } | null>(null);
  const [fontsLoaded, setFontsLoaded] = useState(0);
  const hasWords = words.length > 0;

  // The layout needs the box size and real glyph widths, so it runs on the
  // client once mounted, and again when the box resizes or a font arrives.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setFrame({ width: el.clientWidth, height: el.clientHeight, font: getComputedStyle(el).fontFamily }),
    );
    observer.observe(el);
    const onFonts = () => setFontsLoaded((n) => n + 1);
    document.fonts?.addEventListener("loadingdone", onFonts);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", onFonts);
    };
  }, [hasWords]);

  const measure = useMemo(
    () => (frame ? canvasMeasure(frame.font) : null),
    // fontsLoaded: a font that finished loading changes the measurements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame?.font, fontsLoaded],
  );

  const cloud = useMemo(() => {
    if (!hasWords || !frame || !measure || frame.width === 0 || frame.height === 0) return null;
    const aspect = Math.min(3, Math.max(1, frame.width / frame.height));
    const laid = layoutCloud(words, measure, aspect);
    const scale = Math.min(MAX_SCALE, (frame.width - 8) / laid.width, (frame.height - 8) / laid.height);
    return { words: laid.words, scale };
  }, [hasWords, words, frame, measure]);

  if (!hasWords) {
    return (
      <p className="text-center text-sm text-deck-muted-fg/50 py-12">
        Waiting for responses…
      </p>
    );
  }

  return (
    <div
      ref={root}
      className={
        className ??
        "relative w-full max-w-4xl h-[320px] sm:h-[380px] md:h-[420px] max-h-[52vh] mx-auto overflow-hidden select-none"
      }
    >
      {cloud && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ scale: cloud.scale }}
          transition={SPRING}
        >
          <AnimatePresence>
            {cloud.words.map((word) => (
              <motion.span
                key={word.text}
                initial={{ scale: 0.3, opacity: 0, x: word.x, y: word.y, rotate: word.rotate, fontSize: word.fontSize }}
                animate={{ scale: 1, opacity: 1, x: word.x, y: word.y, rotate: word.rotate, fontSize: word.fontSize }}
                exit={{ scale: 0, opacity: 0 }}
                transition={SPRING}
                style={{ position: "absolute", whiteSpace: "nowrap", lineHeight: 1 }}
                className={`font-black tracking-tight cursor-default select-none ${word.colorClass}`}
                title={showCounts ? `×${word.count}` : undefined}
              >
                {word.text}
              </motion.span>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
