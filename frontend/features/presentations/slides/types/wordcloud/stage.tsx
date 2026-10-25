"use client";

import type { StageViewProps } from "../../runtime";
import { WordCloud } from "./WordCloud";

/** Words grow with every repeat; laid out on a spiral. */
export function WordcloudStage({ live, reveal, mode }: StageViewProps) {
  if (mode === "thumbnail") return <WordCloud words={[]} />;
  const dist = live.distribution ?? reveal?.distribution ?? null;
  if (dist?.kind !== "words") return null;
  return <WordCloud words={dist.words} showCounts />;
}
