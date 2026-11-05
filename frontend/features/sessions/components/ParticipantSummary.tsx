"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Clock, Loader2, Minus, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { eraseMyAnswers } from "../api/sessions";
import { participantKey, readSummaryCredentials } from "../credentials";
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
  const [erased, setErased] = useState(false);

  /** Deletes this participant's answers, then forgets them on this device. */
  async function removeMyAnswers(sid: string) {
    const credentials = readSummaryCredentials(window.localStorage, code, sid);
    if (!credentials) throw new Error("No participant credentials on this device");
    await eraseMyAnswers(sid, credentials.participantId, credentials.token);
    try {
      window.localStorage.removeItem(participantKey(code, sid));
    } catch {
      // Storage unavailable: the server already forgot them.
    }
    setErased(true);
  }

  return (
    <PublicPageShell label={t("kicker")}>
      {erased ? (
        <MessageCard title={t("erasedTitle")} hint={t("erasedHint")}>
          <Button asChild variant="outline" className="bg-card">
            <Link href="/live">{t("joinAnother")}</Link>
          </Button>
        </MessageCard>
      ) : status === "loading" ? (
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
        <TakeHomeContent data={data} onRemove={() => removeMyAnswers(data.session.sessionId)} />
      )}
    </PublicPageShell>
  );
}

/**
 * A participant's results; the page around it handles loading, missing
 * credentials and errors. `onRemove` (ended sessions) offers to delete them.
 */
export function TakeHomeContent({ data, onRemove }: { data: TakeHome; onRemove?: () => Promise<void> }) {
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

      {onRemove && data.session.status === "ended" ? <RemoveMyAnswers onRemove={onRemove} /> : null}
    </div>
  );
}

function RemoveMyAnswers({ onRemove }: { onRemove: () => Promise<void> }) {
  const t = useTranslations("sessions.summary");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onRemove();
    } catch {
      toast.error(t("removeFailed"));
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <section aria-labelledby="remove-title" className="space-y-3 border-t border-border pt-6">
      <h2 id="remove-title" className="text-base font-semibold tracking-[-0.01em]">
        {t("removeTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("removeHint")}</p>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        {t("removeButton")}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold">{t("removeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">{t("removeConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-3">
            <AlertDialogCancel disabled={busy}>{t("removeCancel")}</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void confirm()} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {t("removeConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
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
