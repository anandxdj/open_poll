"use client";

import type { StageViewProps } from "../../runtime";
import { WordCloud } from "./WordCloud";

/**
 * Live, a word keeps its spot and grows there with every repeat; a full cloud
 * starts over with its top words. A session report shows every word at once.
 */
export function WordcloudStage({ live, reveal, mode }: StageViewProps) {
  if (mode === "thumbnail") return <WordCloud words={[]} />;
  const dist = live.distribution ?? reveal?.distribution ?? null;
  if (dist?.kind !== "words") return null;
  return <WordCloud words={dist.words} showCounts mode={mode === "report" ? "fit" : "live"} />;
}
