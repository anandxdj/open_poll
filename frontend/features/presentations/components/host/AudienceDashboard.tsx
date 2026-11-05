"use client";

import { useState } from "react";
import { Check, Clock, Copy, Lock, Play, Radio, RotateCcw, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SlotOutlet } from "../../live/slots";
import { useLive } from "../../live/store";
import type { AudienceParticipantProgress, HostAudienceView, ResultsVisibility } from "../../types";
import { audienceSliceOf } from "../participant/audience/audienceSlice";
import { EndSessionDialog } from "./EndSessionDialog";
import type { HostSession } from "./useHostSession";
import { useJoinLink } from "./useJoinLink";

const primaryButton =
  "rounded-full bg-deck-accent font-semibold text-deck-stage-ink transition-colors hover:bg-deck-accent-soft";
const outlineButton =
  "rounded-full border-deck-stage-fg/20 bg-transparent font-medium text-deck-stage-fg hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg";
const panel = "rounded-xl border border-deck-stage-fg/10 bg-deck-stage-chrome p-4";

/** `YYYY-MM-DDTHH:mm` in local time, for a `datetime-local` input. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const VISIBILITY_KEY: Record<ResultsVisibility, "visibilityNever" | "visibilityAfterSubmit" | "visibilityAfterClose"> = {
  never: "visibilityNever",
  after_submit: "visibilityAfterSubmit",
  after_close: "visibilityAfterClose",
};

/**
 * The host's view of an audience-paced session (W2-F), shown by the host
 * console and the presenter view instead of the stage: there is no current
 * slide, every question is open at once. It shows the join code, the closing
 * time (set when opening, changed while open), **Open to participants**,
 * **Close now** (confirmed in the app's dialog) and **End session**; who is in
 * with each participant's progress, attempt and result; progress per question;
 * and how many started, finished, passed. Data: `host/state.audience`, re-read
 * on answers, joins and attempt events (`useHostSession`).
 */
export function AudienceDashboard({ presentationId, session }: { presentationId: string; session: HostSession }) {
  const t = useTranslations("presenter.audiencePace");
  const locale = useLocale();
  const status = useLive((s) => s.status);
  const joinCode = useLive((s) => s.joinCode);
  const sessionId = useLive((s) => s.sessionId);
  const closeAfterMinutes = useLive((s) => s.deck?.settings?.audiencePaced?.closeAfterMinutes ?? null);
  const view = useLive((s) => audienceSliceOf(s).host);
  const audienceWindow = useLive((s) => audienceSliceOf(s).window);
  const join = useJoinLink(joinCode);
  const { busy } = session;

  const windowState = view?.window ?? audienceWindow;
  const opened = Boolean(windowState?.openedAt);
  const closed = Boolean(windowState?.closedAt);
  const isLive = status === "lobby" || status === "active";
  const state: "ready" | "lobby" | "open" | "closed" | "ended" =
    status === "ended" ? "ended" : status === "lobby" ? "lobby" : status === "active" ? (closed ? "closed" : opened ? "open" : "lobby") : "ready";

  const [closesInput, setClosesInput] = useState("");
  const [editedFor, setEditedFor] = useState<string | null>(null);
  const currentCloses = windowState?.closesAt ?? null;
  if (editedFor !== (currentCloses ?? "") && state === "open") {
    // Follow the server's closing time until the host edits it.
    setEditedFor(currentCloses ?? "");
    setClosesInput(toLocalInput(currentCloses));
  }
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });

  /** The input as an ISO time; undefined when empty; null when it is not in the future. */
  const closesAtFromInput = (): string | undefined | null => {
    if (!closesInput) return undefined;
    const date = new Date(closesInput);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
    return date.toISOString();
  };

  const open = async () => {
    const closesAt = closesAtFromInput();
    if (closesAt === null) {
      toast.error(t("invalidClosingTime"));
      return;
    }
    const response = await session.openAudience(closesAt);
    if (response) toast.success(t("toastOpened"));
  };

  const saveClosingTime = async () => {
    const closesAt = closesAtFromInput();
    if (closesAt === null) {
      toast.error(t("invalidClosingTime"));
      return;
    }
    // Emptied: open until closed by hand.
    const response = await session.openAudience(closesAt ?? null);
    if (response) toast.success(t("toastClosingSaved"));
  };

  const closeNow = async () => {
    const response = await session.closeAudience();
    if (response) toast.success(t("toastClosed"));
  };

  const statusLabel = {
    ready: t("statusReady"),
    lobby: t("statusLobby"),
    open: t("statusOpen"),
    closed: t("statusClosed"),
    ended: t("statusEnded"),
  }[state];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-deck-stage-fg" data-testid="audience-dashboard">
      <div className={`${panel} flex flex-wrap items-start justify-between gap-6`}>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-deck-stage-fg/15 px-2.5 py-1 text-xs font-medium">{t("badge")}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-deck-stage-fg/10 px-2.5 py-1 text-xs font-semibold" role="status">
              {state === "open" ? <span className="size-1.5 rounded-full bg-deck-live motion-safe:animate-pulse" aria-hidden="true" /> : null}
              {state === "closed" || state === "ended" ? <Lock className="size-3" aria-hidden="true" /> : null}
              {statusLabel}
            </span>
          </div>
          <p className="max-w-xl text-sm text-deck-stage-fg/70">{t("intro")}</p>
          {view ? <SettingsLine view={view} /> : null}
          <p className="flex items-center gap-1.5 text-sm" data-testid="audience-closing">
            <Clock className="size-4 text-deck-stage-fg/60" aria-hidden="true" />
            {closed && windowState?.closedAt
              ? windowState.closeReason === "schedule"
                ? `${t("closedBySchedule")} · ${formatTime(windowState.closedAt)}`
                : t("closedAt", { time: formatTime(windowState.closedAt) })
              : opened && currentCloses
                ? t("closesAt", { time: formatTime(currentCloses) })
                : opened
                  ? t("noClosingTime")
                  : null}
          </p>
        </div>

        {isLive && joinCode ? (
          <div className="flex items-center gap-4">
            <div className="space-y-1 text-right">
              <button
                type="button"
                onClick={join.copyUrl}
                title={t("copyLink")}
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm text-deck-stage-fg/70 hover:bg-deck-stage-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50"
              >
                {t("joinAt", { url: join.playUrl.replace(/^https?:\/\//, "").replace(/\/[^/]*$/, "") })}
                {join.copiedUrl ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5 opacity-60" aria-hidden="true" />}
              </button>
              <p className="font-mono text-4xl font-semibold tracking-[0.12em] text-deck-accent" data-testid="audience-join-code">
                {joinCode}
              </p>
            </div>
            {join.playUrl ? (
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG value={join.playUrl} size={88} aria-label={join.playUrl} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={`${panel} flex flex-wrap items-end gap-3`}>
        {state !== "ended" && state !== "closed" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("closesAtLabel")}</span>
            <input
              type="datetime-local"
              value={closesInput}
              onChange={(e) => {
                setClosesInput(e.target.value);
                setEditedFor(currentCloses ?? "");
              }}
              className="h-11 rounded-lg border border-deck-stage-fg/20 bg-deck-stage-bg px-3 text-deck-stage-fg [color-scheme:dark]"
            />
            <span className="text-xs text-deck-stage-fg/60">
              {state !== "open" && closeAfterMinutes ? t("closesAtDefault", { minutes: closeAfterMinutes }) : t("closesAtHint")}
            </span>
          </label>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {state === "ready" || state === "lobby" || state === "closed" ? (
            <Button onClick={() => void open()} disabled={busy} className={`h-11 px-6 text-sm ${primaryButton}`}>
              <Play className="mr-2 size-4 fill-current" aria-hidden="true" /> {state === "closed" ? t("openAgain") : t("open")}
            </Button>
          ) : null}
          {state === "ready" ? (
            <Button variant="outline" onClick={() => void session.openLobby()} disabled={busy} className={`h-11 px-5 text-sm ${outlineButton}`}>
              <Radio className="mr-2 size-4" aria-hidden="true" /> {t("openLobby")}
            </Button>
          ) : null}
          {state === "open" ? (
            <>
              <Button variant="outline" onClick={() => void saveClosingTime()} disabled={busy} className={`h-11 px-5 text-sm ${outlineButton}`}>
                {t("saveClosingTime")}
              </Button>
              <Button onClick={() => setConfirmingClose(true)} disabled={busy} className={`h-11 px-6 text-sm ${primaryButton}`}>
                <Lock className="mr-2 size-4" aria-hidden="true" /> {t("closeNow")}
              </Button>
            </>
          ) : null}
          {isLive ? (
            <Button variant="outline" onClick={() => setConfirmingEnd(true)} disabled={busy} className={`h-11 px-5 text-sm ${outlineButton}`}>
              {t("end")}
            </Button>
          ) : null}
          {state === "ended" ? (
            <Button onClick={() => void open()} disabled={busy} className={`h-11 px-6 text-sm ${primaryButton}`}>
              <RotateCcw className="mr-2 size-4" aria-hidden="true" /> {t("presentAgain")}
            </Button>
          ) : null}
        </div>
      </div>

      {view ? <Stats view={view} /> : null}

      {view ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ProgressPanel view={view} />
          <ParticipantsPanel view={view} />
        </div>
      ) : null}

      {state === "ended" && sessionId ? (
        <div className="flex justify-center">
          <SlotOutlet name="endScreen" props={{ role: "host", presentationId }} />
        </div>
      ) : null}

      <AlertDialog open={confirmingClose} onOpenChange={setConfirmingClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold">{t("closeDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">{t("closeDialogBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-3">
            <AlertDialogCancel>{t("closeDialogCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingClose(false);
                void closeNow();
              }}
            >
              {t("closeDialogConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <EndSessionDialog open={confirmingEnd} onOpenChange={setConfirmingEnd} onConfirm={() => void session.end()} />
    </div>
  );
}

function SettingsLine({ view }: { view: HostAudienceView }) {
  const t = useTranslations("presenter.audiencePace");
  const attempts =
    view.assessment.maxAttempts === null ? t("attemptsUnlimited") : t("attemptsLimit", { count: view.assessment.maxAttempts });
  return (
    <p className="text-sm text-deck-stage-fg/70">
      {view.assessment.enabled ? `${t("assessmentInfo", { percentage: view.assessment.passingScorePercentage, attempts })} · ` : null}
      {t("resultsInfo", { visibility: t(VISIBILITY_KEY[view.resultsVisibility]) })}
    </p>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className={panel}>
      <p className="text-xs font-medium uppercase tracking-wider text-deck-stage-fg/60">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function Stats({ view }: { view: HostAudienceView }) {
  const t = useTranslations("presenter.audiencePace");
  return (
    <div className={`grid gap-3 ${view.assessment.enabled ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-3"}`}>
      <Stat label={t("participants")} value={String(view.participantCount)} testId="audience-stat-participants" />
      <Stat label={t("started")} value={String(view.startedCount)} testId="audience-stat-started" />
      <Stat
        label={t("finished")}
        value={t("finishedOf", { done: view.completedCount, total: view.participantCount })}
        testId="audience-stat-finished"
      />
      {view.assessment.enabled ? (
        <>
          <Stat label={t("passed")} value={String(view.passedCount)} testId="audience-stat-passed" />
          <Stat label={t("notPassed")} value={String(view.failedCount)} testId="audience-stat-failed" />
        </>
      ) : null}
    </div>
  );
}

function ProgressPanel({ view }: { view: HostAudienceView }) {
  const t = useTranslations("presenter.audiencePace");
  const total = view.participantCount;
  return (
    <section className={`${panel} space-y-3`} aria-labelledby="audience-progress-title">
      <h2 id="audience-progress-title" className="text-sm font-semibold">
        {t("progressTitle")}
      </h2>
      <ol className="space-y-3">
        {view.slides.map((slide, i) => {
          const percent = total > 0 ? Math.round((slide.answeredCount / total) * 100) : 0;
          return (
            <li key={slide.slideId} className="space-y-1" data-testid="audience-slide-progress">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="mr-2 font-mono text-deck-stage-fg/50">{i + 1}</span>
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
    </section>
  );
}

function ParticipantStatus({ participant }: { participant: AudienceParticipantProgress }) {
  const t = useTranslations("presenter.audiencePace");
  if (participant.kicked) return <span className="text-deck-stage-fg/50">{t("removed")}</span>;
  const result = participant.lastResult;
  if (participant.submitted && result) {
    if (result.passed === true) return <span className="font-semibold text-deck-correct-soft">{t("passedWith", { percentage: result.percentage ?? 0 })}</span>;
    if (result.passed === false) return <span className="font-semibold text-deck-danger-soft">{t("failedWith", { percentage: result.percentage ?? 0 })}</span>;
    return <span className="font-semibold">{result.percentage !== null ? t("scoreWith", { percentage: result.percentage }) : t("submitted")}</span>;
  }
  if (participant.answeredCount === 0 && !result) return <span className="text-deck-stage-fg/60">{t("notStarted")}</span>;
  return <span>{t("inProgress")}</span>;
}

function ParticipantsPanel({ view }: { view: HostAudienceView }) {
  const t = useTranslations("presenter.audiencePace");
  return (
    <section className={`${panel} space-y-3`} aria-labelledby="audience-who-title">
      <h2 id="audience-who-title" className="flex items-center gap-2 text-sm font-semibold">
        <Users className="size-4" aria-hidden="true" /> {t("whoTitle")}
      </h2>
      {view.participants.length === 0 ? (
        <p className="text-sm text-deck-stage-fg/60">{t("noParticipants")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-deck-stage-fg/60">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">{t("colName")}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("colProgress")}</th>
                {view.assessment.enabled ? <th scope="col" className="py-2 pr-3 font-medium">{t("colAttempt")}</th> : null}
                <th scope="col" className="py-2 font-medium">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {view.participants.map((participant) => (
                <tr key={participant.participantId} className="border-t border-deck-stage-fg/10" data-testid="audience-participant-row">
                  <td className="max-w-[160px] truncate py-2 pr-3 font-medium">{participant.name}</td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {participant.answeredCount}/{view.totalQuestions}
                  </td>
                  {view.assessment.enabled ? <td className="py-2 pr-3 font-mono tabular-nums">{participant.attempt}</td> : null}
                  <td className="py-2">
                    <ParticipantStatus participant={participant} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
