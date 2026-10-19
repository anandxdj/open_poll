import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ImportIntlProvider } from "@/features/imports/ImportIntlProvider";
import type { ImportCapabilities } from "@/features/imports/hooks/useImportCapabilities";
import type { ImportRunState, ImportTranslator } from "@/features/imports/hooks/useImportRun";
import type { ImportJob } from "@/features/imports/types";
import imports from "@/messages/en/imports.json";

// The capability hook reads the network; the panels are rendered with chosen capabilities instead.
let capabilities: ImportCapabilities = { known: false, storage: false, pptxHighFidelity: false, googleDriveImport: false };
mock.module("@/features/imports/hooks/useImportCapabilities", () => ({ useImportCapabilities: () => capabilities }));

const html = (element: ReactElement) => renderToStaticMarkup(<ImportIntlProvider>{element}</ImportIntlProvider>);

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const job = (status: ImportJob["status"], extra: Partial<ImportJob> = {}): ImportJob => ({
  id: "j1",
  kind: "pptx",
  status,
  stage: null,
  title: null,
  warnings: [],
  error: null,
  resultPresentationId: null,
  createdAt: "2026-10-19T00:00:00Z",
  startedAt: null,
  finishedAt: null,
  ...extra,
});

let FilePanel: typeof import("@/features/imports/components/FilePanel").FilePanel;
let GooglePanel: typeof import("@/features/imports/components/GooglePanel").GooglePanel;
let QuestionsPanel: typeof import("@/features/imports/components/QuestionsPanel").QuestionsPanel;
let QuestionsPreview: typeof import("@/features/imports/components/QuestionsPreview").QuestionsPreview;
let JobStatus: typeof import("@/features/imports/components/JobStatus").JobStatus;
let describeImportError: typeof import("@/features/imports/hooks/useImportRun").describeImportError;

beforeAll(async () => {
  ({ FilePanel } = await import("@/features/imports/components/FilePanel"));
  ({ GooglePanel } = await import("@/features/imports/components/GooglePanel"));
  ({ QuestionsPanel } = await import("@/features/imports/components/QuestionsPanel"));
  ({ QuestionsPreview } = await import("@/features/imports/components/QuestionsPreview"));
  ({ JobStatus } = await import("@/features/imports/components/JobStatus"));
  ({ describeImportError } = await import("@/features/imports/hooks/useImportRun"));
});

describe("file panel", () => {
  test("offers the file chooser and explains nothing while the capabilities are unknown", () => {
    capabilities = { known: false, storage: false, pptxHighFidelity: false, googleDriveImport: false };
    const markup = html(<FilePanel />);
    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept=".pptx,.pdf"');
    expect(text(markup)).toContain("Drop a .pptx or .pdf here");
    expect(text(markup)).not.toContain("File uploads are not set up");
    expect(markup).not.toMatch(/<input[^>]*type="file"[^>]*disabled/);
  });

  test("says why uploads are off when the server has no storage, and disables the form", () => {
    capabilities = { known: true, storage: false, pptxHighFidelity: false, googleDriveImport: false };
    const markup = html(<FilePanel />);
    expect(text(markup)).toContain("File uploads are not set up");
    expect(text(markup)).toContain("File storage is not configured on this server");
    expect(markup).toMatch(/<input[^>]*type="file"[^>]*disabled|<input[^>]*disabled[^>]*type="file"/);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>\s*Import file/);
  });

  test("tells what happens to charts and diagrams, by capability", () => {
    capabilities = { known: true, storage: true, pptxHighFidelity: false, googleDriveImport: false };
    expect(text(html(<FilePanel />))).toContain("Charts, SmartArt diagrams and videos cannot be imported on this server");
    capabilities = { known: true, storage: true, pptxHighFidelity: true, googleDriveImport: false };
    expect(text(html(<FilePanel />))).toContain("imported as a picture of the slide");
  });
});

describe("google panel", () => {
  test("asks for a link and explains private files by capability", () => {
    capabilities = { known: true, storage: true, pptxHighFidelity: false, googleDriveImport: false };
    let markup = html(<GooglePanel />);
    expect(markup).toContain('placeholder="https://docs.google.com/presentation/d/…/edit"');
    expect(text(markup)).toContain("Only presentations shared as \"Anyone with the link\" can be imported");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>\s*Import from Google Slides/);

    capabilities = { known: true, storage: false, pptxHighFidelity: false, googleDriveImport: true };
    markup = html(<GooglePanel />);
    expect(text(markup)).toContain("Private Google Drive files can be imported through the API");
    expect(text(markup)).toContain("pictures in the presentation are not imported");
  });
});

describe("questions panel", () => {
  test("offers both templates and a csv/xlsx chooser", () => {
    const markup = html(<QuestionsPanel target={{ kind: "newDeck" }} />);
    expect(text(markup)).toContain("CSV template");
    expect(text(markup)).toContain("Excel template");
    expect(markup).toContain('accept=".csv,.xlsx"');
  });
});

describe("questions preview", () => {
  test("lists the questions with readable types and the rows that will be skipped", () => {
    const markup = html(
      <QuestionsPreview
        questions={[
          { row: 2, type: "select_answer", question: "Capital of France?", detail: "3 options, 1 correct" },
          { row: 3, type: "ranking", question: "Order <b>these</b>", detail: "3 items" },
        ]}
        errors={[{ row: 4, column: "type", message: 'type "bogus" is not one of select_answer' }]}
      />,
    );
    const plain = text(markup);
    expect(plain).toContain("Multiple choice");
    expect(plain).toContain("Ranking");
    expect(plain).toContain("Capital of France?");
    expect(plain).toContain("3 options, 1 correct");
    expect(plain).toContain("Rows that will be skipped");
    expect(plain).toContain('Row 4: type "bogus" is not one of select_answer');
    // Question text is text, never markup.
    expect(markup).not.toContain("<b>these</b>");
    expect(markup).toContain("&lt;b&gt;these&lt;/b&gt;");
  });
});

describe("job status", () => {
  const noop = () => {};
  const render = (state: Exclude<ImportRunState, { phase: "idle" }>) => html(<JobStatus state={state} onRetry={noop} onReset={noop} />);

  test("shows upload progress", () => {
    const plain = text(render({ phase: "uploading", fileName: "deck.pptx", progress: 0.42 }));
    expect(plain).toContain("Uploading deck.pptx");
    expect(plain).toContain("42%");
  });

  test("shows queued and running stages", () => {
    expect(text(render({ phase: "tracking", job: job("queued") }))).toContain("Waiting for a free import worker");
    expect(text(render({ phase: "tracking", job: job("running", { stage: "Importing pictures" }) }))).toContain("Importing: Importing pictures");
    expect(text(render({ phase: "submitting" }))).toContain("Importing");
  });

  test("a finished import links to the deck and lists what to check", () => {
    const markup = render({
      phase: "done",
      job: job("completed", {
        resultPresentationId: "64b000000000000000000001",
        warnings: [{ code: "CHART_NOT_IMPORTED", message: "Slide 3 has a chart, which was not imported.", slide: 3 }],
      }),
    });
    expect(markup).toContain('href="/presentation/create?id=64b000000000000000000001"');
    const plain = text(markup);
    expect(plain).toContain("1 thing to check");
    expect(plain).toContain("Slide 3 has a chart, which was not imported.");
  });

  test("a failed import shows the reason and offers a retry", () => {
    const markup = render({ phase: "failed", message: "This PDF is password protected. Remove the password and try again." });
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain("The import failed.");
    expect(text(markup)).toContain("password protected");
    expect(text(markup)).toContain("Try again");
  });
});

describe("error wording", () => {
  const translator = (has: (key: string) => boolean = () => false, wrap = (key: string) => key) =>
    Object.assign((key: string) => wrap(key), { has }) as ImportTranslator;
  const apiError = (code: string, message: string) => ({
    isAxiosError: true,
    response: { status: 503, data: { code, message } },
  });

  test("falls back from known codes to the API message to a generic line", () => {
    expect(describeImportError(new Error("boom"), translator())).toBe("boom");
    expect(describeImportError("???", translator())).toBe("errors.generic");
    expect(describeImportError(apiError("X", "Server said no"), translator())).toBe("Server said no");
    const known = translator((key) => key === "errors.STORAGE_DISABLED", (key) => `translated:${key}`);
    expect(describeImportError(apiError("STORAGE_DISABLED", "File storage is not configured"), known)).toBe(
      "translated:errors.STORAGE_DISABLED",
    );
  });

  test("every error code the API raises for imports has a message", () => {
    for (const code of ["STORAGE_DISABLED", "PLAN_LIMIT_REACHED", "FORBIDDEN", "GOOGLE_DRIVE_DISABLED", "QUEUE_UNAVAILABLE"]) {
      expect(Object.keys(imports.errors)).toContain(code);
    }
  });
});
