"use client";

import { Clock, Lock, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLocale, useTranslations } from "next-intl";

import { useLive } from "../../live/store";
import { audienceSliceOf } from "../participant/audience/audienceSlice";
import type { JoinLinkControls } from "./StageLobby";

/**
 * The stage of an audience-paced session while it runs (W2-F): there is no
 * current slide, every question is open on the phones. The projected screen
 * (host stage, audience window, embedded screen) shows how to join and how far
 * the room is — participants, finished, progress per question, the closing
 * time — never a person's answers or results. A screen's state carries only
 * these counts (`modules/embeds` drops the per-participant rows and the
 * distributions until the slides close).
 */
export function StageAudience({ join }: { join: JoinLinkControls }) {
  const t = useTranslations("presenter.audiencePace");
  const locale = useLocale();
  const joinCode = useLive((s) => s.joinCode);
  const view = useLive((s) => audienceSliceOf(s).host);
  const audienceWindow = useLive((s) => audienceSliceOf(s).window ?? audienceSliceOf(s).host?.window ?? null);
  const closed = Boolean(audienceWindow?.closedAt);
  const { playUrl } = join;
  const total = view?.participantCount ?? 0;

  return (
    <div className="relative my-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="stage-audience">
      <div className="space-y-6 text-center lg:text-left">
        <div className="space-y-2">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{closed ? t("stageClosedTitle") : t("stageTitle")}</h2>
          <p className="text-base text-deck-stage-fg/70">{closed ? t("stageClosedHint") : t("stageHint")}</p>
        </div>
        {!closed ? (
          <div className="flex flex-col items-center gap-5 sm:flex-row lg:items-center">
            <div className="rounded-2xl border border-deck-stage-fg/15 bg-deck-stage-panel px-8 py-6 text-center">
              <p className="text-sm font-medium text-deck-stage-muted">
                {playUrl ? t("joinAt", { url: playUrl.replace(/^https?:\/\//, "").replace(/\/[^/]*$/, "") }) : null}
              </p>
              <p className="font-mono text-5xl font-semibold tracking-[0.12em] text-deck-accent tabular-nums">{joinCode}</p>
            </div>
            {playUrl ? (
              <div className="rounded-2xl bg-deck-qr-bg p-4">
                <QRCodeSVG value={playUrl} size={132} aria-label={t("qrLabel", { url: playUrl })} />
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="flex items-center justify-center gap-2 text-base text-deck-stage-fg/80 lg:justify-start">
          {closed ? <Lock className="size-4" aria-hidden="true" /> : <Clock className="size-4" aria-hidden="true" />}
          {closed
            ? t("statusClosed")
            : audienceWindow?.closesAt
              ? t("closesAt", { time: new Date(audienceWindow.closesAt).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }) })
              : t("noClosingTime")}
        </p>
      </div>

      {view ? (
        <div className="space-y-5 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-chrome p-6">
          <div className="flex flex-wrap items-center gap-6 text-lg">
            <span className="flex items-center gap-2" data-testid="stage-audience-participants">
              <Users className="size-5 text-deck-accent" aria-hidden="true" /> {t("stageParticipants", { count: total })}
            </span>
            <span data-testid="stage-audience-finished">{t("stageFinished", { done: view.completedCount, total })}</span>
          </div>
          <ol className="space-y-3">
            {view.slides.map((slide, i) => {
              const percent = total > 0 ? Math.round((slide.answeredCount / total) * 100) : 0;
              return (
                <li key={slide.slideId} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 font-mono text-deck-stage-muted">{i + 1}</span>
                      {slide.label}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-deck-stage-fg/70">
                      {t("progressRow", { answered: slide.answeredCount, total })}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-deck-stage-fg/10" aria-hidden="true">
                    <div className="h-full rounded-full bg-deck-accent transition-[width]" style={{ width: `${percent}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
