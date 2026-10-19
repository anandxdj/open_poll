"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getApiErrorMessage } from "@/lib/api-error";
import { createImport, getImport, getImportErrorCode, uploadImportSource } from "../api/imports.api";
import { PollGaveUp, pollImportJob } from "../logic";
import type { ImportJob, SourceKind } from "../types";

export type ImportRunState =
  | { phase: "idle" }
  | { phase: "uploading"; fileName: string; progress: number }
  | { phase: "submitting" }
  | { phase: "tracking"; job: ImportJob }
  | { phase: "done"; job: ImportJob }
  | { phase: "failed"; message: string; job?: ImportJob };

/** The translator of the `imports` namespace with free-form keys (error codes are looked up by name). */
export interface ImportTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/** A sentence for the person: the API's code when we have words for it, else its own message, else a generic line. */
export function describeImportError(error: unknown, t: ImportTranslator): string {
  const code = getImportErrorCode(error);
  if (code && t.has(`errors.${code}`)) return t(`errors.${code}`);
  const message = getApiErrorMessage(error) ?? (error instanceof Error ? error.message : undefined);
  return message || t("errors.generic");
}

/**
 * One import of a file or a link: upload (files), queue, follow the job to its
 * end. Unmounting stops following; the job itself keeps running on the server.
 */
export function useImportRun() {
  const translator = useTranslations("imports");
  const t = translator as unknown as ImportTranslator;
  const [state, setState] = useState<ImportRunState>({ phase: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const follow = useCallback(
    async (first: ImportJob, signal: AbortSignal) => {
      setState({ phase: "tracking", job: first });
      try {
        const job = await pollImportJob(first.id, {
          fetchJob: getImport,
          onUpdate: (update) => setState({ phase: "tracking", job: update }),
          signal,
        });
        setState(
          job.status === "completed"
            ? { phase: "done", job }
            : { phase: "failed", message: job.error?.message ?? t("job.failed"), job }
        );
      } catch (error) {
        if (signal.aborted) return;
        setState({
          phase: "failed",
          message: error instanceof PollGaveUp ? t(error.reason === "timeout" ? "job.timedOut" : "job.lostTrack") : describeImportError(error, t),
        });
      }
    },
    [t]
  );

  const begin = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  }, []);

  const runFile = useCallback(
    async (file: File, kind: SourceKind, title: string) => {
      const controller = begin();
      setState({ phase: "uploading", fileName: file.name, progress: 0 });
      try {
        const key = await uploadImportSource(file, kind, {
          signal: controller.signal,
          onProgress: (progress) => setState({ phase: "uploading", fileName: file.name, progress }),
        });
        setState({ phase: "submitting" });
        const job = await createImport({ kind, key, ...(title.trim() ? { title: title.trim() } : {}) });
        await follow(job, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ phase: "failed", message: describeImportError(error, t) });
      }
    },
    [begin, follow, t]
  );

  const runLink = useCallback(
    async (url: string, title: string) => {
      const controller = begin();
      setState({ phase: "submitting" });
      try {
        const job = await createImport({ kind: "gslides", url: url.trim(), ...(title.trim() ? { title: title.trim() } : {}) });
        await follow(job, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ phase: "failed", message: describeImportError(error, t) });
      }
    },
    [begin, follow, t]
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({ phase: "idle" });
  }, []);

  return { state, runFile, runLink, reset };
}
