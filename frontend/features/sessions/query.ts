import type { PresentationSlide } from "@/features/presentations/types/deck";
import type { LiveParticipant, RevealDistribution } from "@/features/presentations/types/live";
import type {
  ExportFormat,
  PublicResultSlide,
  ReportParticipant,
  ReportSlide,
  SessionReport,
  SessionSummaryItem,
  SlideDistribution,
} from "./types";

/** Pure view logic of the sessions screens, unit tested in `tests/unit/sessions.query.test.ts`. */

// ---------- Formatting ----------

/** "42 min", "1 h 05 min", "35 s": a session's length. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "-";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} h ${String(totalMinutes % 60).padStart(2, "0")} min`;
}

/** 0.4166 → "42%"; null → "-". */
export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "-";
  return `${Math.round(Math.min(1, Math.max(0, rate)) * 100)}%`;
}

export function formatDateTime(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

/** Response time in seconds with one decimal: 4250 → "4.3 s". */
export function formatResponseTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

// ---------- Routes and links ----------

export const sessionsPath = (presentationId: string) => `/presentations/${presentationId}/sessions`;
export const reportPath = (presentationId: string, sessionId: string) =>
  `${sessionsPath(presentationId)}/${sessionId}`;

export const resultsPath = (token: string) => `/r/${encodeURIComponent(token)}`;
export const shareUrl = (origin: string, token: string) => `${origin.replace(/\/$/, "")}${resultsPath(token)}`;

/** The participant take-home page; `sid` pins the session (the end screen knows it). */
export const summaryPath = (code: string, sessionId?: string | null) =>
  `/live/${encodeURIComponent(code)}/summary${sessionId ? `?sid=${encodeURIComponent(sessionId)}` : ""}`;

export const runTitle = (item: Pick<SessionSummaryItem, "runNumber">) => `Session ${item.runNumber}`;

// ---------- Exports ----------

export const EXPORT_FORMATS: readonly { format: ExportFormat; label: string; hint: string }[] = [
  { format: "csv", label: "CSV", hint: "One row per participant and slide" },
  { format: "xlsx", label: "Excel", hint: "Summary, results, responses, participants" },
  { format: "pdf", label: "PDF", hint: "Printable report with charts" },
];

export interface ExportOption {
  format: ExportFormat;
  label: string;
  hint: string;
  /** The plan includes it. */
  included: boolean;
}

export function exportOptions(report: Pick<SessionReport, "exports">): ExportOption[] {
  return EXPORT_FORMATS.map((entry) => ({ ...entry, included: report.exports[entry.format] === true }));
}

export const exportFileFallback = (title: string, runNumber: number, format: ExportFormat) => {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session";
  return `${slug}-run-${runNumber}.${format}`;
};

// ---------- Share ----------

export const SHARE_EXPIRY_CHOICES = [
  { key: "never", label: "Never expires", days: null },
  { key: "1d", label: "In 24 hours", days: 1 },
  { key: "7d", label: "In 7 days", days: 7 },
  { key: "30d", label: "In 30 days", days: 30 },
] as const;
export type ShareExpiryKey = (typeof SHARE_EXPIRY_CHOICES)[number]["key"];

/**
 * The expiry the share dialog starts on: keep the current one, unless it
 * has passed (a lapsed expiry cannot be kept; start from a week, visibly).
 */
export function defaultExpiryChoice(
  share: { expiresAt: string | null } | null,
  now = Date.now()
): ShareExpiryKey | "keep" {
  if (!share) return "never";
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= now) return "7d";
  return "keep";
}

/** ISO expiry for a choice, relative to `now` (null = never). */
export function expiryFor(key: ShareExpiryKey, now = Date.now()): string | null {
  const choice = SHARE_EXPIRY_CHOICES.find((entry) => entry.key === key);
  return choice?.days ? new Date(now + choice.days * 24 * 3600 * 1000).toISOString() : null;
}

/** "Expires Mar 3, 2026", "Expired Mar 3, 2026" or "Never expires". */
export function expiryLabel(expiresAt: string | null, now = Date.now(), locale?: string): string {
  if (!expiresAt) return "Never expires";
  const at = new Date(expiresAt).getTime();
  return `${at <= now ? "Expired" : "Expires"} ${formatDateTime(expiresAt, locale)}`;
}

// ---------- Report slides → stage views ----------

/** What the registry's StageView renders: the stored slide with the fields the type views read defaulted. */
export function toStageSlide(source: Record<string, unknown>): PresentationSlide {
  const options = Array.isArray(source.options)
    ? (source.options as Record<string, unknown>[]).map((option) => ({
        text: typeof option.text === "string" ? option.text : "",
        // A participant-facing slide has no answer keys; the distribution carries the correct ones.
        isCorrect: option.isCorrect === true,
      }))
    : [];
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    ...source,
    type: source.type as PresentationSlide["type"],
    question: typeof source.question === "string" ? source.question : "",
    options,
    acceptedAnswers: list(source.acceptedAnswers),
    statements: list(source.statements),
    minLabel: typeof source.minLabel === "string" ? source.minLabel : "",
    maxLabel: typeof source.maxLabel === "string" ? source.maxLabel : "",
    scaleMax: num(source.scaleMax, 5),
    items: list(source.items),
    maxEntries: num(source.maxEntries, 3),
    timeLimit: num(source.timeLimit, 0),
    points: num(source.points, 0),
    scoreDependsOnTime: source.scoreDependsOnTime === true,
  } as PresentationSlide;
}

export const asRevealDistribution = (distribution: SlideDistribution | null): RevealDistribution | null =>
  distribution && typeof distribution.kind === "string" ? (distribution as unknown as RevealDistribution) : null;

/** Slides with results to chart: shown response slides (those with a distribution or answers). */
export function chartedSlides(slides: ReportSlide[]): ReportSlide[] {
  return slides.filter((slide) => slide.lifecycle === "response" && slide.visited);
}

/** Response slides the session never reached. */
export function skippedSlides(slides: ReportSlide[]): ReportSlide[] {
  return slides.filter((slide) => slide.lifecycle === "response" && !slide.visited);
}

export function publicSlides(slides: PublicResultSlide[]): PublicResultSlide[] {
  return [...slides].sort((a, b) => a.slideIndex - b.slideIndex);
}

/** The report's participants as the stage views' participant list (they size the charts). */
export const stageParticipants = (participants: ReportParticipant[]): LiveParticipant[] =>
  participants.map((p) => ({ participantId: p.participantId, name: p.name, score: p.score }));

// ---------- Participants table ----------

export const PARTICIPANT_PAGE_SIZE = 25;

/** Case-insensitive name filter; the report order (rank) is kept. */
export function filterParticipants(participants: ReportParticipant[], query: string): ReportParticipant[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return participants;
  return participants.filter((p) => p.name.toLowerCase().includes(needle));
}

export function pageOf<T>(items: T[], page: number, size = PARTICIPANT_PAGE_SIZE): { rows: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { rows: items.slice(current * size, (current + 1) * size), pages, page: current };
}

/** Share of answered response slides: 3 of 4 → "75%". */
export function answeredShare(participant: Pick<ReportParticipant, "answeredCount">, responseSlides: number): string {
  return responseSlides > 0 ? formatPercent(participant.answeredCount / responseSlides) : "-";
}

// ---------- Take-home ----------

/** Correctness tone of a take-home row. */
export type AnswerTone = "correct" | "wrong" | "pending" | "unscored" | "skipped";

export function answerTone(slide: { scored: boolean; answered: boolean; isCorrect: boolean | null }): AnswerTone {
  if (!slide.answered) return "skipped";
  if (!slide.scored) return "unscored";
  if (slide.isCorrect === null) return "pending";
  return slide.isCorrect ? "correct" : "wrong";
}
