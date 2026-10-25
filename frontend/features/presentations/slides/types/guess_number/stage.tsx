"use client";

import { motion } from "framer-motion";
import { Target } from "lucide-react";
import { useTranslations } from "next-intl";

import { formatNumber, percentOf } from "../../advanced/read";
import type { StageViewProps } from "../../runtime";
import { ease, isRevealMode } from "../../shared";
import { guessNumberConfig } from "./config";
import {
  emptyGuessDistribution,
  isCorrectBucket,
  parseGuessDistribution,
  type GuessBucket,
  type GuessDistribution,
} from "./distribution";

const bucketLabel = (bucket: GuessBucket) =>
  bucket.from === bucket.to
    ? formatNumber(bucket.from, 4)
    : `${formatNumber(bucket.from, 4)}–${formatNumber(bucket.to, 4)}`;

/** A faint bell for thumbnails, so an empty slide still reads as a histogram. */
const placeholderHeight = (i: number, n: number) => 12 + 80 * Math.exp(-((i - (n - 1) / 2) ** 2) / (2 * (n / 4.5) ** 2));

/**
 * The guesses as a histogram with their count, mean and median. After the
 * reveal the correct number (± tolerance) lights up the bars it covers.
 */
export function GuessNumberStage({ slide, live, reveal, mode }: StageViewProps) {
  const t = useTranslations("slidesAdvanced.guessNumber");
  const config = guessNumberConfig(slide);
  const thumbnail = mode === "thumbnail";
  const parsed: GuessDistribution | null = thumbnail ? null : parseGuessDistribution(live.distribution ?? reveal?.distribution);
  const dist = parsed && parsed.buckets.length > 0 ? parsed : emptyGuessDistribution(config);
  const showCorrect = isRevealMode(mode) && dist.correct !== null;

  const maxCount = Math.max(1, ...dist.buckets.map((bucket) => bucket.count));
  const labelEvery = Math.ceil(dist.buckets.length / 10);
  const tolerance = dist.tolerance > 0 ? ` ± ${formatNumber(dist.tolerance, 4)}` : "";

  return (
    <div className={`pt-2 font-sans ${thumbnail ? "" : "max-h-[55vh] overflow-y-auto"}`}>
      <div className="mx-auto w-full max-w-2xl space-y-3">
        <div className="flex h-44 items-end gap-1.5 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/5 px-3 pt-4 pb-1 sm:gap-2">
          {dist.buckets.map((bucket, i) => {
            const correct = showCorrect && isCorrectBucket(bucket, dist.correct, dist.tolerance, dist.step);
            const height = thumbnail
              ? placeholderHeight(i, dist.buckets.length)
              : bucket.count > 0
                ? Math.max(4, percentOf(bucket.count, maxCount))
                : 0;
            return (
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="h-4 font-mono text-xs font-bold tabular-nums text-deck-stage-fg/80">
                  {!thumbnail && bucket.count > 0 ? bucket.count : ""}
                </span>
                <div className="flex w-full flex-1 items-end">
                  {height > 0 ? (
                    <motion.div
                      className={`w-full rounded-t-lg ${
                        correct
                          ? "bg-gradient-to-t from-deck-correct to-deck-correct-alt"
                          : "bg-gradient-to-t from-deck-accent-strong to-deck-accent"
                      } ${thumbnail ? "opacity-30" : ""}`}
                      initial={{ height: 0 }}
                      animate={{ height: `${height}%` }}
                      transition={{ duration: 0.6, ease }}
                    />
                  ) : (
                    <div className="h-0.5 w-full rounded-full bg-deck-stage-fg/10" />
                  )}
                </div>
                <span
                  className={`h-4 w-full truncate text-center font-mono text-[10px] tabular-nums ${
                    correct ? "font-bold text-deck-correct-soft" : "text-deck-stage-fg/50"
                  }`}
                >
                  {i % labelEvery === 0 ? bucketLabel(bucket) : ""}
                </span>
              </div>
            );
          })}
        </div>

        <ol className="sr-only" aria-label={t("histogram")}>
          {dist.buckets.map((bucket, i) => (
            <li key={i}>{t("bucket", { range: bucketLabel(bucket), count: bucket.count })}</li>
          ))}
        </ol>

        {!thumbnail && (
          <dl className="flex flex-wrap items-center justify-center gap-2 text-center">
            <Stat label={t("guesses")} value={String(dist.count)} />
            {dist.count > 0 && dist.mean !== null && <Stat label={t("mean")} value={formatNumber(dist.mean, 2)} />}
            {dist.count > 0 && dist.median !== null && <Stat label={t("median")} value={formatNumber(dist.median, 2)} />}
          </dl>
        )}

        {showCorrect && dist.correct !== null && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease }}
            className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl border border-deck-correct/50 bg-deck-correct-deep/20 px-5 py-2.5"
          >
            <Target className="size-5 shrink-0 text-deck-correct-soft" aria-hidden />
            <p className="text-sm font-medium text-deck-stage-fg/70">
              {t("correctAnswer")}
            </p>
            <p className="text-xl font-extrabold tabular-nums text-deck-correct-soft">
              {formatNumber(dist.correct, 4)}
              {tolerance}
            </p>
            {dist.correctCount !== null && dist.count > 0 && (
              <p className="text-xs text-deck-stage-fg/60">
                {t("correctCount", { correct: dist.correctCount, total: dist.count })}
              </p>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/5 px-4 py-1.5">
      <dt className="text-sm font-medium text-deck-stage-fg/60">{label}</dt>
      <dd className="text-lg font-extrabold tabular-nums text-deck-stage-fg">{value}</dd>
    </div>
  );
}
