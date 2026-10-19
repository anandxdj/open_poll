"use client";

import Link from "next/link";
import { Check, Clock, Minus, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTakeHome } from "../hooks/useTakeHome";
import { answerTone, formatResponseTime, type AnswerTone } from "../query";
import type { TakeHome, TakeHomeSlide } from "../types";
import { MessageCard, Skeleton, StatTile } from "./ui";

const toneStyle: Record<AnswerTone, string> = {
  correct: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  wrong: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  unscored: "border-border bg-secondary/40 text-muted-foreground",
  skipped: "border-border bg-secondary/20 text-muted-foreground/70",
};
const toneIcon = { correct: Check, wrong: X, pending: Clock, unscored: Check, skipped: Minus } as const;

/**
 * `/live/[code]/summary`: a participant's own results after (or during) a
 * session. Identity comes from this browser's storage; nothing is shown
 * without the participant's own token.
 */
export function ParticipantSummary({ code, sessionId }: { code: string; sessionId?: string | null }) {
  const t = useTranslations("sessions.summary");
  const { status, data, reload } = useTakeHome(code, sessionId);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto w-full max-w-lg space-y-5 px-4 py-8">
        {status === "loading" ? (
          <div role="status" aria-label={t("loading")} className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-40" />
          </div>
        ) : status === "noCredentials" ? (
          <MessageCard title={t("noCredentialsTitle")} hint={t("noCredentialsHint")}>
            <Button asChild className="rounded-xl font-bold">
              <Link href="/live">{t("joinAnother")}</Link>
            </Button>
          </MessageCard>
        ) : status === "notFound" ? (
          <MessageCard title={t("notFoundTitle")} hint={t("notFoundHint")}>
            <Button asChild variant="outline" className="rounded-xl">
              <Link href="/live">{t("joinAnother")}</Link>
            </Button>
          </MessageCard>
        ) : status === "removed" ? (
          <MessageCard title={t("removedTitle")} />
        ) : status === "failed" || !data ? (
          <MessageCard tone="error" title={t("loadFailed")}>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={reload}>
              <RefreshCw /> {t("retry")}
            </Button>
          </MessageCard>
        ) : (
          <TakeHomeContent data={data} />
        )}
      </main>
    </div>
  );
}

/** A participant's results; the page around it handles loading, missing credentials and errors. */
export function TakeHomeContent({ data }: { data: TakeHome }) {
  const t = useTranslations("sessions.summary");
  return (
    <>
        <header className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t("kicker")}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{data.me.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t("run", { title: data.session.title, number: data.session.runNumber })}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-3">
          <StatTile
            label={t("rank")}
            value={t("rankOf", { rank: data.me.rank, total: data.session.participantCount })}
          />
          <StatTile label={t("score")} value={data.me.score.toLocaleString()} />
          <StatTile label={t("correct")} value={data.me.correctCount} />
          <StatTile
            label={t("answered")}
            value={t("answeredOf", { answered: data.me.answeredCount, total: data.slides.length })}
          />
        </dl>

        {data.session.status !== "ended" ? (
          <p role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
            {t("liveHint")}
          </p>
        ) : null}

        <section aria-labelledby="answers-title" className="space-y-3">
          <h2 id="answers-title" className="text-base font-bold tracking-tight">
            {t("slidesTitle")}
          </h2>
          {data.slides.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptySlides")}</p>
          ) : (
            <ol className="space-y-3">
              {data.slides.map((slide) => (
                <li key={slide.slideId}>
                  <AnswerCard slide={slide} />
                </li>
              ))}
            </ol>
          )}
        </section>
    </>
  );
}

function AnswerCard({ slide }: { slide: TakeHomeSlide }) {
  const t = useTranslations("sessions.summary");
  const tone = answerTone(slide);
  const Icon = toneIcon[tone];

  return (
    <article className="space-y-3 rounded-[1.5rem] border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            {t("slideNumber", { number: slide.slideIndex + 1 })}
          </p>
          <h3 className="text-sm font-bold leading-snug text-foreground/90">{slide.label}</h3>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
            toneStyle[tone]
          )}
        >
          <Icon aria-hidden className="size-3" />
          {t(`status.${tone}`)}
        </span>
      </header>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{t("yourAnswer")}</dt>
          <dd className={cn("break-words font-medium", !slide.answer && "text-muted-foreground")}>
            {slide.answer ?? t("noAnswer")}
          </dd>
        </div>
        {slide.correctAnswer && slide.isCorrect !== true ? (
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{t("correctAnswer")}</dt>
            <dd className="break-words font-medium text-emerald-600 dark:text-emerald-400">{slide.correctAnswer}</dd>
          </div>
        ) : null}
      </dl>

      {slide.answered ? (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {slide.points !== null ? (
            <span className="font-bold tabular-nums text-foreground/80">
              {slide.points > 0 ? t("points", { points: slide.points.toLocaleString() }) : t("noPoints")}
            </span>
          ) : null}
          {slide.timeMs !== null ? <span>{t("timeTaken", { time: formatResponseTime(slide.timeMs) })}</span> : null}
        </footer>
      ) : null}
    </article>
  );
}
