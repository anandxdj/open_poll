"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { advance, EMPTY_CLOUD, seededRand, type CloudMode, type CloudState, type Frame, type Measure, type Word } from "./cloudLayout";

interface WordCloudProps {
  words: Word[];
  /** Show count superscript on each word (host view context) */
  showCounts?: boolean;
  /** Replaces the default size of the cloud's box (the landing sample draws it in its own box). */
  className?: string;
  /**
   * `live` (default): words keep their spot and grow there; a full cloud starts
   * over with its top words. `fit`: every word at once, shrunk to fit (reports).
   */
  mode?: CloudMode;
}

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

/** `tracking-tight`, in em. */
const TRACKING = -0.025;

// Soft enough that a growing word swells rather than snaps.
const SPRING = { type: "spring", stiffness: 170, damping: 24 } as const;

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

interface Laid {
  cloud: CloudState;
  /** The words and counts it was laid out for. */
  key: string | null;
  frame: Frame | null;
  measure: Measure | null;
}

export function WordCloud({ words, showCounts = false, className, mode = "live" }: WordCloudProps) {
  const root = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<(Frame & { font: string }) | null>(null);
  const [fontsLoaded, setFontsLoaded] = useState(0);
  const hasWords = words.length > 0;

  // The layout needs the box size and real glyph widths, so it runs on the
  // client once mounted, and again when the box resizes or a font arrives.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight, font: getComputedStyle(el).fontFamily };
      setFrame((prev) =>
        prev && prev.width === next.width && prev.height === next.height && prev.font === next.font ? prev : next,
      );
    });
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

  // The cloud on screen is the starting point for the next one, so words keep
  // their spots between updates (and when a font finishes loading and the words
  // are measured again). Only a new box size lays it out afresh.
  // Parents often pass a new array with the same counts: only a real change moves anything.
  const key = words.map((w) => `${w.text}\u0000${w.count}`).join("\u0001");
  const [laid, setLaid] = useState<Laid>({ cloud: EMPTY_CLOUD, key: null, frame: null, measure: null });
  if (frame && measure && (laid.key !== key || laid.frame !== frame || laid.measure !== measure)) {
    const start = laid.frame === frame ? laid.cloud : EMPTY_CLOUD;
    setLaid({ cloud: advance(start, words, frame, measure, mode), key, frame, measure });
  }

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
      <div className="absolute inset-0 flex items-center justify-center">
        <AnimatePresence>
          {laid.cloud.words.map((word) => (
            <motion.span
              key={word.text}
              initial={{ scale: 0.4, opacity: 0, x: word.spanX, y: word.spanY, rotate: word.rotate, fontSize: word.fontSize }}
              animate={{ scale: 1, opacity: 1, x: word.spanX, y: word.spanY, rotate: word.rotate, fontSize: word.fontSize }}
              exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.3 } }}
              transition={SPRING}
              style={{ position: "absolute", whiteSpace: "nowrap", lineHeight: 1 }}
              className={`font-black tracking-tight cursor-default select-none ${PALETTE[Math.floor(seededRand(word.text + "_col") * PALETTE.length)]}`}
              title={showCounts ? `×${word.count}` : undefined}
            >
              {word.text}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
