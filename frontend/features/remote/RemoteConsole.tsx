"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  Ban,
  ChevronLeft,
  Eye,
  Loader2,
  Lock,
  Pause,
  Play,
  Radio,
  Smartphone,
  TimerReset,
  WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCountdown } from "@/features/presentations/live/useCountdown";
import type { RemoteCommand, RemoteState } from "@/features/presentations/types";
import { DeckThemeProvider } from "@/features/presentations/theme/DeckThemeProvider";
import { deckThemeFrom } from "@/features/themes/deckTheme";
import { useAppThemeMode } from "@/features/themes/useAppThemeMode";
import { useRemote, type RemoteLink } from "./useRemote";

const button =
  "flex min-h-16 items-center justify-center gap-2 rounded-2xl border border-deck-stage-fg/15 bg-deck-stage-chrome px-4 text-base font-semibold text-deck-stage-fg transition-colors active:bg-deck-stage-panel disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/60";

/**
 * The phone remote at `/remote/<token>` (W2-A): big buttons for next,
 * previous, reveal, close voting, +30 s and pause/resume, the slide on screen
 * with its phase, timer and responses, and the speaker notes. The first phone
 * to open the pairing link binds it; any other phone sees that it is taken.
 */
export function RemoteConsole({ token }: { token: string }) {
  const { link, state, serverOffsetMs, pending, send } = useRemote(token);
  const appMode = useAppThemeMode();
  // The remote looks like the stage it drives: the live session's theme, else the deck's
  // (light or dark); the app's own until the first state arrives.
  return (
    <DeckThemeProvider theme={deckThemeFrom(state?.theme) ?? { mode: appMode }}>
      <RemoteBody link={link} state={state} serverOffsetMs={serverOffsetMs} pending={pending} send={send} />
    </DeckThemeProvider>
  );
}

function RemoteBody({
  link,
  state,
  serverOffsetMs,
  pending,
  send,
}: Pick<ReturnType<typeof useRemote>, "link" | "state" | "serverOffsetMs" | "pending" | "send">) {
  const t = useTranslations("remote");

  const run = async (command: RemoteCommand) => {
    const outcome = await send(command);
    if (outcome.ok) return;
    if (outcome.error === "UNAVAILABLE" || !outcome.message) toast.error(t("commandUnavailable"));
    else toast.error(t("commandFailed", { message: outcome.message }));
  };

  if (link === "invalid" || link === "bound" || link === "revoked" || (link === "failed" && !state)) {
    return <RemoteRefusal link={link} />;
  }
  if (!state) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-deck-stage-muted">
          <Loader2 className="size-8 animate-spin" aria-hidden="true" />
          <p className="text-sm">{t("connecting")}</p>
        </div>
      </Shell>
    );
  }
  return <RemoteControls state={state} link={link} serverOffsetMs={serverOffsetMs} pending={pending} onCommand={run} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-deck-stage-bg px-4 pb-6 pt-4 font-sans text-deck-stage-fg">{children}</main>
  );
}

function RemoteRefusal({ link }: { link: RemoteLink }) {
  const t = useTranslations("remote");
  const title =
    link === "bound" ? t("boundTitle") : link === "revoked" ? t("revokedTitle") : link === "failed" ? t("failedTitle") : t("invalidTitle");
  const hint = link === "bound" ? t("boundHint") : link === "failed" ? "" : t("invalidHint");
  return (
    <Shell>
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Ban className="size-10 text-deck-danger-soft" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
        {hint && <p className="max-w-sm text-sm text-deck-stage-muted">{hint}</p>}
        {link === "failed" && (
          <button type="button" onClick={() => window.location.reload()} className={`${button} mt-2 min-h-12 px-6`}>
            {t("retry")}
          </button>
        )}
      </div>
    </Shell>
  );
}

interface RemoteControlsProps {
  state: RemoteState;
  link: RemoteLink;
  serverOffsetMs: number;
  pending: RemoteCommand | null;
  onCommand: (command: RemoteCommand) => void;
}

function RemoteControls({ state, link, serverOffsetMs, pending, onCommand }: RemoteControlsProps) {
  const t = useTranslations("remote");
  const [showNotes, setShowNotes] = useState(true);
  const slide = state.slide;
  const countdown = useCountdown(
    slide && slide.phase === "open" && slide.timed
      ? { endsAt: slide.endsAt, pausedRemainingMs: slide.pausedRemainingMs, durationMs: slide.durationMs, clockOffsetMs: serverOffsetMs }
      : null,
    30
  );

  const active = state.status === "active";
  const response = active && slide?.lifecycle === "response";
  const open = response && slide?.phase === "open";
  const timed = open && Boolean(slide?.timed);
  const busy = pending !== null || link !== "live";
  const canNext = state.status === "lobby" || (active && !slide?.isLastSlide);

  const phaseLabel =
    slide?.phase === "open" ? t("phaseOpen") : slide?.phase === "closed" ? t("phaseClosed") : slide?.phase === "revealed" ? t("phaseRevealed") : null;
  const timerLabel = !open
    ? null
    : countdown.paused
      ? t("paused")
      : countdown.timed
        ? t("secondsLeft", { seconds: countdown.secondsLeft })
        : t("untimed");

  return (
    <Shell>
      <header className="flex items-center justify-between gap-3 pb-3">
        <span className="flex min-w-0 items-center gap-2">
          <Smartphone className="size-4 shrink-0 text-deck-stage-muted" aria-hidden="true" />
          <h1 className="truncate text-sm font-semibold">{state.title}</h1>
        </span>
        <span role="status" data-testid="remote-link-status" className="flex shrink-0 items-center gap-1.5 text-xs text-deck-stage-muted">
          {link === "live" ? (
            <>
              <span className="size-1.5 rounded-full bg-deck-live" aria-hidden="true" /> {t("connected")}
            </>
          ) : (
            <>
              <WifiOff className="size-3.5" aria-hidden="true" /> {t("reconnecting")}
            </>
          )}
        </span>
      </header>

      {/* The status card. Its state lines are live regions (a screen reader hears the lobby, each slide and
          its phase); the ticking timer is a silent role="timer" outside them (W4-A). */}
      <section className="space-y-2 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-chrome p-4" aria-label={t("statusLabel")}>
        <div role="status" className="space-y-2">
          {state.status === "draft" && <p className="text-sm text-deck-stage-fg/70">{t("draft")}</p>}
          {state.status === "lobby" && (
            <p className="flex items-center gap-2 text-sm text-deck-stage-fg/80">
              <Radio className="size-4 text-deck-live" aria-hidden="true" /> {t("lobby", { count: state.participantCount })}
            </p>
          )}
          {state.status === "ended" && <p className="text-sm text-deck-stage-fg/70">{t("ended")}</p>}
          {active && slide && (
            <>
              <p className="font-mono text-xs tabular-nums text-deck-stage-muted" data-testid="remote-slide-position">
                {t("slideOf", { current: slide.slideIndex + 1, total: state.totalSlides })}
              </p>
              <h2 className="text-balance text-xl font-semibold leading-snug tracking-[-0.02em]" data-testid="remote-slide-title">
                {slide.title}
              </h2>
            </>
          )}
        </div>
        {active && slide && response && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-deck-stage-fg/70">
            {phaseLabel && (
              <span role="status" data-testid="remote-phase">
                {phaseLabel}
              </span>
            )}
            {timerLabel && (
              <span className="font-mono tabular-nums" data-testid="remote-timer" role="timer" aria-label={t("timerLabel")}>
                {timerLabel}
              </span>
            )}
            <span>{t("answered", { answered: slide.answeredCount, total: state.participantCount })}</span>
          </div>
        )}
        {state.next && state.status !== "ended" && (
          <p className="truncate pt-1 text-xs text-deck-stage-muted">
            {t("upNext")}: {state.next.title}
          </p>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => onCommand("prev")} disabled={busy || !active || (slide?.slideIndex ?? 0) <= 0} className={button}>
          <ChevronLeft className="size-5" aria-hidden="true" /> {t("prev")}
        </button>
        <button
          type="button"
          onClick={() => onCommand("next")}
          disabled={busy || !canNext}
          className={cn(button, "border-transparent bg-deck-accent text-deck-stage-ink active:bg-deck-accent-soft")}
        >
          {t("next")} <ArrowRight className="size-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onCommand("reveal")} disabled={busy || !response || slide?.phase === "revealed"} className={button}>
          <Eye className="size-5" aria-hidden="true" /> {t("reveal")}
        </button>
        <button type="button" onClick={() => onCommand("close")} disabled={busy || !open} className={button}>
          <Lock className="size-5" aria-hidden="true" /> {t("close")}
        </button>
        <button type="button" onClick={() => onCommand("extend30")} disabled={busy || !timed} className={button}>
          <TimerReset className="size-5" aria-hidden="true" /> {t("extend30")}
        </button>
        {countdown.paused ? (
          <button type="button" onClick={() => onCommand("resume")} disabled={busy || !timed} className={button}>
            <Play className="size-5 fill-current" aria-hidden="true" /> {t("resume")}
          </button>
        ) : (
          <button type="button" onClick={() => onCommand("pause")} disabled={busy || !timed || countdown.expired} className={button}>
            <Pause className="size-5" aria-hidden="true" /> {t("pause")}
          </button>
        )}
      </div>

      {active && slide && (
        <section className="mt-4 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-chrome p-4">
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            aria-expanded={showNotes}
            className="flex min-h-11 w-full items-center justify-between text-xs font-medium uppercase tracking-wider text-deck-stage-muted"
          >
            {t("notes")} <span aria-hidden="true">{showNotes ? "−" : "+"}</span>
          </button>
          {showNotes && (
            <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-deck-stage-fg/90" data-testid="remote-notes">
              {slide.notes || t("noNotes")}
            </p>
          )}
        </section>
      )}
    </Shell>
  );
}
