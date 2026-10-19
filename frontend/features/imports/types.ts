/** Wire shapes of /api/imports (backend/docs/wiki/modules/imports.md). */

export type ImportKind = "pptx" | "pdf" | "gslides" | "csv" | "xlsx";
export type ImportStatus = "queued" | "running" | "completed" | "failed";

export interface ImportWarning {
  code: string;
  message: string;
  /** 1-based slide or page in the source, when the warning is about one. */
  slide: number | null;
}

export interface ImportJob {
  id: string;
  kind: ImportKind;
  status: ImportStatus;
  /** What the worker is doing right now (only while running). */
  stage: string | null;
  title: string | null;
  warnings: ImportWarning[];
  error: { code: string; message: string } | null;
  resultPresentationId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type SourceKind = "pptx" | "pdf";
export type QuestionFileKind = "csv" | "xlsx";

export interface QuestionPreviewRow {
  row: number;
  type: string;
  question: string;
  detail: string;
}

export interface QuestionRowError {
  row: number;
  column: string | null;
  message: string;
}

export interface QuestionsResult {
  mode: "preview" | "import";
  fileKind: QuestionFileKind;
  totalRows: number;
  imported: number;
  skipped: number;
  /** Slides that still fit in the target deck. */
  capacity: number;
  questions: QuestionPreviewRow[];
  errors: QuestionRowError[];
  warnings: ImportWarning[];
  /** Parsed slides, in preview mode only (the builder adds them to its deck). */
  slides?: Array<Record<string, unknown> & { type: string }>;
  importId?: string;
  presentationId?: string;
  created?: boolean;
  slideCount?: number;
}
