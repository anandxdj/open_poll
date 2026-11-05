"use client";

import Link from "next/link";
import { Check, Clock, Minus, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTakeHome } from "../hooks/useTakeHome";
import { answerTone, formatResponseTime, type AnswerTone } from "../query";
import type { TakeHome, TakeHomeSlide } from "../types";
import { PublicPageShell } from "@/features/landing/components/shared/PublicPageShell";
import { LiveNotice, MessageCard, SectionTitle, Skeleton, StatStrip } from "./ui";

const toneStyle: Record<AnswerTone, string> = {
  correct: "border-success/30 bg-success/10 text-success",
  wrong: "border-destructive/30 bg-destructive/10 text-destructive",
  pending: "border-warning/30 bg-warning/10 text-warning",
  unscored: "border-border bg-secondary text-muted-foreground",
  skipped: "border-border bg-background text-muted-foreground",
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
    <PublicPageShell label={t("kicker")}>
      {status === "loading" ? (
        <div role="status" aria-label={t("loading")} className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
        </div>
      ) : status === "noCredentials" ? (
        <MessageCard title={t("noCredentialsTitle")} hint={t("noCredentialsHint")}>
          <Button asChild>
            <Link href="/live">{t("joinAnother")}</Link>
          </Button>
        </MessageCard>
      ) : status === "notFound" ? (
        <MessageCard title={t("notFoundTitle")} hint={t("notFoundHint")}>
          <Button asChild variant="outline" className="bg-card">
            <Link href="/live">{t("joinAnother")}</Link>
          </Button>
        </MessageCard>
      ) : status === "removed" ? (
        <MessageCard title={t("removedTitle")} />
      ) : status === "failed" || !data ? (
        <MessageCard tone="error" title={t("loadFailed")}>
          <Button variant="outline" size="sm" className="bg-card" onClick={reload}>
            <RefreshCw /> {t("retry")}
          </Button>
        </MessageCard>
      ) : (
        <TakeHomeContent data={data} />
      )}
    </PublicPageShell>
  );
}

/** A participant's results; the page around it handles loading, missing credentials and errors. */
export function TakeHomeContent({ data }: { data: TakeHome }) {
  const t = useTranslations("sessions.summary");
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-semibold leading-none tracking-[-0.04em]">{data.me.name}</h1>
        <p className="mt-3 text-base text-muted-foreground">
          {t("run", { title: data.session.title, number: data.session.runNumber })}
        </p>
      </header>

      <StatStrip
        pairs
        stats={[
          { label: t("rank"), value: t("rankOf", { rank: data.me.rank, total: data.session.participantCount }) },
          { label: t("score"), value: data.me.score.toLocaleString() },
          { label: t("correct"), value: data.me.correctCount },
          { label: t("answered"), value: t("answeredOf", { answered: data.me.answeredCount, total: data.slides.length }) },
        ]}
      />

      {data.session.status !== "ended" ? <LiveNotice>{t("liveHint")}</LiveNotice> : null}

      <section aria-labelledby="answers-title" className="space-y-4">
        <SectionTitle id="answers-title">{t("slidesTitle")}</SectionTitle>
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
    </div>
  );
}

function AnswerCard({ slide }: { slide: TakeHomeSlide }) {
  const t = useTranslations("sessions.summary");
  const tone = answerTone(slide);
  const Icon = toneIcon[tone];

  return (
    <article className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{t("slideNumber", { number: slide.slideIndex + 1 })}</p>
          <h3 className="mt-0.5 text-base font-semibold leading-snug tracking-[-0.01em]">{slide.label}</h3>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
            toneStyle[tone]
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          {t(`status.${tone}`)}
        </span>
      </header>

      <dl className="grid gap-2.5 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("yourAnswer")}</dt>
          <dd className={cn("mt-0.5 break-words text-base font-medium", !slide.answer && "text-muted-foreground")}>
            {slide.answer ?? t("noAnswer")}
          </dd>
        </div>
        {slide.correctAnswer && slide.isCorrect !== true ? (
          <div>
            <dt className="text-muted-foreground">{t("correctAnswer")}</dt>
            <dd className="mt-0.5 break-words text-base font-medium text-success">{slide.correctAnswer}</dd>
          </div>
        ) : null}
      </dl>

      {slide.answered ? (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
          {slide.points !== null ? (
            <span className="font-mono tabular-nums text-foreground">
              {slide.points > 0 ? t("points", { points: slide.points.toLocaleString() }) : t("noPoints")}
            </span>
          ) : null}
          {slide.timeMs !== null ? <span>{t("timeTaken", { time: formatResponseTime(slide.timeMs) })}</span> : null}
        </footer>
      ) : null}
    </article>
  );
}
