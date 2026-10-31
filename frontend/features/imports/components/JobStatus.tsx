"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ImportRunState } from "../hooks/useImportRun";
import { deckHref } from "../logic";
import type { ImportWarning } from "../types";

export function WarningList({ warnings }: { warnings: ImportWarning[] }) {
  const t = useTranslations("imports");
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
        <AlertTriangle className="size-3.5" aria-hidden /> {t("job.warningsTitle", { count: warnings.length })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t("job.warningsHint")}</p>
      <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-4 text-xs text-foreground/80">
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${warning.slide ?? "x"}-${index}`}>{warning.message}</li>
        ))}
      </ul>
    </div>
  );
}

/** Progress, result and errors of one file/link import. */
export function JobStatus({
  state,
  onRetry,
  onReset,
}: {
  state: Exclude<ImportRunState, { phase: "idle" }>;
  onRetry: () => void;
  onReset: () => void;
}) {
  const t = useTranslations("imports");

  if (state.phase === "uploading") {
    const percent = Math.round(state.progress * 100);
    return (
      <div className="space-y-2" role="status" aria-live="polite">
        <p className="text-sm font-medium">{t("file.uploading", { name: state.fileName })}</p>
        <Progress value={percent} aria-label={t("job.uploading")} />
        <p className="text-xs tabular-nums text-muted-foreground">{percent}%</p>
      </div>
    );
  }

  if (state.phase === "submitting" || state.phase === "tracking") {
    const job = state.phase === "tracking" ? state.job : null;
    const label = !job
      ? t("job.running")
      : job.status === "queued"
        ? t("job.queued")
        : job.stage
          ? t("job.stage", { stage: job.stage })
          : t("job.running");
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 p-4" role="status" aria-live="polite">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <p className="text-sm font-medium">{label}</p>
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
          <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-semibold">{t("job.failed")}</p>
            <p className="text-sm text-foreground/80">{state.message}</p>
          </div>
        </div>
        {state.job && state.job.warnings.length > 0 ? <WarningList warnings={state.job.warnings} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onReset}>
            {t("job.startOver")}
          </Button>
          <Button onClick={onRetry}>{t("job.tryAgain")}</Button>
        </div>
      </div>
    );
  }

  const { job } = state;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="text-sm font-semibold">{job.title ? t("job.completed", { title: job.title }) : t("job.completedNoTitle")}</p>
      </div>
      <WarningList warnings={job.warnings} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onReset}>
          {t("job.startOver")}
        </Button>
        {job.resultPresentationId ? (
          <Button asChild>
            <Link href={deckHref(job.resultPresentationId)}>{t("job.openDeck")}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
