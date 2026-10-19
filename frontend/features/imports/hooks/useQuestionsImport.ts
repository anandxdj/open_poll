"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { sendQuestions } from "../api/imports.api";
import { classifyQuestionFile } from "../logic";
import type { QuestionsResult } from "../types";
import { describeImportError, type ImportTranslator } from "./useImportRun";

export type QuestionsState =
  | { phase: "idle" }
  | { phase: "checking"; file: File }
  | { phase: "preview"; file: File; result: QuestionsResult }
  | { phase: "importing"; file: File; result: QuestionsResult }
  | { phase: "done"; result: QuestionsResult }
  | { phase: "error"; message: string; file?: File };

/**
 * Question-file import: choosing a file asks the server to check it (`preview`),
 * the person sees the rows and problems, and only then does `submit` write the
 * deck. Rows with problems are skipped, never block the rest.
 */
export function useQuestionsImport() {
  const translator = useTranslations("imports");
  const t = translator as unknown as ImportTranslator;
  const [state, setState] = useState<QuestionsState>({ phase: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const choose = useCallback(
    async (file: File, title: string) => {
      controllerRef.current?.abort();
      const check = classifyQuestionFile(file);
      if (!check.ok) {
        setState({ phase: "error", message: t(`questions.${check.reason === "type" ? "wrongType" : check.reason}`), file });
        return;
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ phase: "checking", file });
      try {
        const result = await sendQuestions({ file, mode: "preview", title }, controller.signal);
        setState({ phase: "preview", file, result });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ phase: "error", message: describeImportError(error, t), file });
      }
    },
    [t]
  );

  const submit = useCallback(
    async (title: string) => {
      if (state.phase !== "preview") return;
      const { file, result } = state;
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ phase: "importing", file, result });
      try {
        const done = await sendQuestions({ file, mode: "import", title }, controller.signal);
        setState({ phase: "done", result: done });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ phase: "error", message: describeImportError(error, t), file });
      }
    },
    [state, t]
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({ phase: "idle" });
  }, []);

  return { state, choose, submit, reset };
}
