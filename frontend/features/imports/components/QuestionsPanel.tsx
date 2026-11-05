"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadQuestionsTemplate } from "../api/imports.api";
import { useQuestionsImport } from "../hooks/useQuestionsImport";
import { QUESTIONS_ACCEPT, deckHref } from "../logic";
import type { QuestionsResult } from "../types";
import { FilePicker } from "./FilePicker";
import { WarningList } from "./JobStatus";
import { QuestionsPreview } from "./QuestionsPreview";

/** Where the checked questions go. */
export type QuestionsTarget =
  /** A new deck is created on the server (the library's Import). */
  | { kind: "newDeck" }
  /** The deck open in the builder: slides are handed to `onAdd`, nothing is written until the deck is saved. */
  | {
      kind: "localDeck";
      room: number;
      onAdd: (slides: NonNullable<QuestionsResult["slides"]>) => void;
      /** The person is finished with the confirmation (closes the dialog). */
      onDone: () => void;
    };

/** CSV or Excel questions: templates, file, preview with row errors, import. */
export function QuestionsPanel({ target }: { target: QuestionsTarget }) {
  const t = useTranslations("imports");
  const { state, choose, submit, reset } = useQuestionsImport();
  const [title, setTitle] = useState("");
  const [templateError, setTemplateError] = useState(false);
  const [added, setAdded] = useState<number | null>(null);

  const download = async (format: "csv" | "xlsx") => {
    setTemplateError(false);
    try {
      await downloadQuestionsTemplate(format);
    } catch {
      setTemplateError(true);
    }
  };

  const startOver = () => {
    reset();
    setAdded(null);
  };

  if (state.phase === "done") {
    const { result } = state;
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4" role="status">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="space-y-0.5 text-sm">
            <p className="font-semibold">{t("questions.imported", { count: result.imported })}</p>
            {result.skipped > 0 ? <p className="text-foreground/80">{t("questions.importedSkipped", { skipped: result.skipped })}</p> : null}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={startOver}>
            {t("job.startOver")}
          </Button>
          {result.presentationId ? (
            <Button asChild>
              <Link href={deckHref(result.presentationId)}>{t("job.openDeck")}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (added !== null) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4" role="status">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p className="text-sm font-semibold">{t("builder.added", { count: added })}</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => (target.kind === "localDeck" ? target.onDone() : undefined)}>{t("dialog.done")}</Button>
        </div>
      </div>
    );
  }

  const file = state.phase === "idle" ? null : state.phase === "error" ? (state.file ?? null) : state.file;
  const result = state.phase === "preview" || state.phase === "importing" ? state.result : null;
  const busy = state.phase === "checking" || state.phase === "importing";

  // In the builder only as many slides fit as the deck has room for.
  const room = target.kind === "localDeck" ? target.room : (result?.imported ?? 0);
  const count = result ? Math.min(result.imported, room) : 0;

  const onSubmit = () => {
    if (!result) return;
    if (target.kind === "localDeck") {
      target.onAdd((result.slides ?? []).slice(0, count));
      setAdded(count);
    } else {
      void submit(title);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("questions.intro")}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t("questions.templates")}</span>
        <Button variant="outline" size="sm" onClick={() => void download("csv")}>
          {t("questions.templateCsv")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void download("xlsx")}>
          {t("questions.templateXlsx")}
        </Button>
        {templateError ? (
          <span role="alert" className="text-destructive">
            {t("questions.templateFailed")}
          </span>
        ) : null}
      </div>

      <FilePicker
        accept={QUESTIONS_ACCEPT}
        label={t("questions.drop")}
        selected={file ? file.name : null}
        onFile={(next) => void choose(next, title)}
        disabled={busy}
        error={state.phase === "error" ? state.message : null}
      />

      {state.phase === "checking" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t("questions.checking", { name: state.file.name })}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold" role="status">
            {result.imported > 0 ? t("questions.ready", { count }) : t("questions.noneValid")}
            {result.skipped > 0 ? <span className="font-normal text-muted-foreground"> · {t("questions.skipped", { count: result.skipped })}</span> : null}
          </p>
          {target.kind === "localDeck" && count < result.imported ? (
            <p className="text-xs text-muted-foreground">{t("builder.capacity", { count: target.room })}</p>
          ) : null}
          <QuestionsPreview questions={result.questions} errors={result.errors} />
          <WarningList warnings={result.warnings} />
          {target.kind === "newDeck" ? (
            <div className="space-y-1.5">
              <Label htmlFor="import-questions-title">{t("questions.titleLabel")}</Label>
              <Input
                id="import-questions-title"
                value={title}
                maxLength={120}
                placeholder={t("questions.titlePlaceholder")}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={startOver} disabled={busy}>
              {t("questions.change")}
            </Button>
            <Button onClick={onSubmit} disabled={count === 0 || busy}>
              {state.phase === "importing" ? t("questions.importing") : target.kind === "localDeck" ? t("builder.submit", { count }) : t("questions.submit", { count })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
