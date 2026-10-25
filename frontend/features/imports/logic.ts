import type { ImportJob, ImportStatus, QuestionFileKind, SourceKind } from "./types";

/** Pure rules of the import UI: what a file may be, what a link must look like, how to poll. Unit tested. */

const MB = 1024 * 1024;

export const MAX_SOURCE_BYTES = 100 * MB;
export const MAX_QUESTION_BYTES = 2 * MB;

export const SOURCE_MIME: Record<SourceKind, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

export const SOURCE_ACCEPT = ".pptx,.pdf";
export const QUESTIONS_ACCEPT = ".csv,.xlsx";

type FileLike = Pick<File, "name" | "type" | "size">;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export type SourceFileCheck =
  | { ok: true; kind: SourceKind; mime: string }
  | { ok: false; reason: "type" | "empty" | "tooLarge" };

/**
 * Whether `file` can be uploaded for import, and as which kind. The extension decides (browsers report an empty
 * or generic type for .pptx on many systems); a type that contradicts the extension is refused.
 */
export function classifySourceFile(file: FileLike): SourceFileCheck {
  const extension = extensionOf(file.name);
  const kind: SourceKind | null = extension === "pptx" ? "pptx" : extension === "pdf" ? "pdf" : null;
  if (!kind) return { ok: false, reason: "type" };
  const reported = file.type.toLowerCase();
  if (reported && reported !== "application/octet-stream" && reported !== SOURCE_MIME[kind]) {
    return { ok: false, reason: "type" };
  }
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, reason: "tooLarge" };
  return { ok: true, kind, mime: SOURCE_MIME[kind] };
}

export type QuestionFileCheck = { ok: true; kind: QuestionFileKind } | { ok: false; reason: "type" | "empty" | "tooLarge" };

export function classifyQuestionFile(file: FileLike): QuestionFileCheck {
  const extension = extensionOf(file.name);
  if (extension !== "csv" && extension !== "xlsx") return { ok: false, reason: "type" };
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_QUESTION_BYTES) return { ok: false, reason: "tooLarge" };
  return { ok: true, kind: extension };
}

/** The document id of a Google Slides address, or null. Mirrors the backend's rule (https, docs.google.com). */
export function parseGoogleSlidesLink(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.username || url.password) return null;
  const match = url.pathname.match(/^\/presentation\/(?:u\/\d+\/)?d\/(?:e\/)?([^/]+)/);
  const id = match?.[1];
  return id && /^[A-Za-z0-9_-]{15,128}$/.test(id) ? id : null;
}

export const isTerminal = (status: ImportStatus) => status === "completed" || status === "failed";

/** Where the new deck opens: the builder, like every deck card's Edit. */
export const deckHref = (presentationId: string) => `/presentation/create?id=${encodeURIComponent(presentationId)}`;

export const formatBytes = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Delay before poll number `attempt` (0-based): quick at first, settling at 3 s. */
export const pollDelay = (attempt: number) => Math.min(3000, 700 + attempt * 400);

/** Total time a job is followed before the dialog gives up (the job keeps running on the server). */
export const POLL_GIVE_UP_MS = 15 * 60_000;

export interface PollOptions {
  fetchJob: (id: string) => Promise<ImportJob>;
  onUpdate: (job: ImportJob) => void;
  signal?: AbortSignal;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Consecutive failed reads tolerated before giving up. */
  maxErrors?: number;
  giveUpAfterMs?: number;
}

export class PollGaveUp extends Error {
  constructor(readonly reason: "errors" | "timeout") {
    super(`Stopped following the import (${reason})`);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Follows a job until it finishes. Resolves with the final job; rejects with `PollGaveUp` when reads keep failing
 * or it takes too long, and with the signal's reason when aborted.
 */
export async function pollImportJob(id: string, options: PollOptions): Promise<ImportJob> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const maxErrors = options.maxErrors ?? 5;
  const deadline = now() + (options.giveUpAfterMs ?? POLL_GIVE_UP_MS);
  let failures = 0;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const job = await options.fetchJob(id);
      failures = 0;
      options.onUpdate(job);
      if (isTerminal(job.status)) return job;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (++failures >= maxErrors) throw new PollGaveUp("errors");
    }
    if (now() >= deadline) throw new PollGaveUp("timeout");
    await sleep(pollDelay(attempt));
  }
}

/** Fraction 0–1 of the bar shown while an upload runs (the upload is most of the wait for big files). */
export const uploadFraction = (fraction: number) => Math.min(1, Math.max(0, fraction));
