"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { QuestionPreviewRow, QuestionRowError } from "../types";

const TYPE_KEYS = ["select_answer", "type_answer", "wordcloud", "open_ended", "scales", "ranking"] as const;
type TypeKey = (typeof TYPE_KEYS)[number];
const isTypeKey = (type: string): type is TypeKey => (TYPE_KEYS as readonly string[]).includes(type);

/** Table of the questions the server found, and the rows it will skip with the reason for each. */
export function QuestionsPreview({ questions, errors }: { questions: QuestionPreviewRow[]; errors: QuestionRowError[] }) {
  const t = useTranslations("imports");
  return (
    <div className="space-y-3">
      {questions.length > 0 ? (
        <div className="max-h-56 overflow-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs" aria-label={t("questions.previewLabel")}>
            <thead className="sticky top-0 bg-secondary text-xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("questions.colRow")}</th>
                <th scope="col" className="px-3 py-2">{t("questions.colType")}</th>
                <th scope="col" className="px-3 py-2">{t("questions.colQuestion")}</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("questions.colDetails")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {questions.map((question) => (
                <tr key={question.row}>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{question.row}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {isTypeKey(question.type) ? t(`types.${question.type}`) : question.type}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 font-medium text-foreground/90" title={question.question}>
                    {question.question}
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{question.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="size-3.5" aria-hidden /> {t("questions.problemsTitle")}
          </p>
          <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs text-foreground/80">
            {errors.map((error) => (
              <li key={`${error.row}-${error.column ?? ""}-${error.message}`}>
                {t("questions.problem", { row: error.row, message: error.message })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
