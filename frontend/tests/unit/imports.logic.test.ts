import { describe, expect, test } from "bun:test";

import {
  MAX_QUESTION_BYTES,
  MAX_SOURCE_BYTES,
  PollGaveUp,
  SOURCE_MIME,
  classifyQuestionFile,
  classifySourceFile,
  deckHref,
  formatBytes,
  isTerminal,
  parseGoogleSlidesLink,
  pollDelay,
  pollImportJob,
} from "@/features/imports/logic";
import type { ImportJob } from "@/features/imports/types";

const file = (name: string, type = "", size = 1000) => ({ name, type, size });

describe("source files", () => {
  test("accepts .pptx and .pdf by extension, with the type browsers report or none", () => {
    expect(classifySourceFile(file("deck.pptx", SOURCE_MIME.pptx))).toEqual({ ok: true, kind: "pptx", mime: SOURCE_MIME.pptx });
    expect(classifySourceFile(file("Deck.PPTX", ""))).toMatchObject({ ok: true, kind: "pptx" });
    expect(classifySourceFile(file("deck.pptx", "application/octet-stream"))).toMatchObject({ ok: true, kind: "pptx" });
    expect(classifySourceFile(file("talk.pdf", "application/pdf"))).toEqual({ ok: true, kind: "pdf", mime: "application/pdf" });
  });

  test("refuses other types, a type that contradicts the name, empty and oversized files", () => {
    for (const bad of [file("deck.ppt"), file("deck.docx"), file("deck"), file("deck.pptx.exe"), file("deck.pdf", "image/png"), file("deck.pptx", "application/pdf")]) {
      expect(classifySourceFile(bad)).toEqual({ ok: false, reason: "type" });
    }
    expect(classifySourceFile(file("deck.pptx", "", 0))).toEqual({ ok: false, reason: "empty" });
    expect(classifySourceFile(file("deck.pptx", "", MAX_SOURCE_BYTES + 1))).toEqual({ ok: false, reason: "tooLarge" });
    expect(classifySourceFile(file("deck.pptx", "", MAX_SOURCE_BYTES))).toMatchObject({ ok: true });
  });
});

describe("question files", () => {
  test("accepts csv and xlsx, refuses the rest", () => {
    expect(classifyQuestionFile(file("q.csv"))).toEqual({ ok: true, kind: "csv" });
    expect(classifyQuestionFile(file("Q.XLSX"))).toEqual({ ok: true, kind: "xlsx" });
    expect(classifyQuestionFile(file("q.xls"))).toEqual({ ok: false, reason: "type" });
    expect(classifyQuestionFile(file("q.csv", "", 0))).toEqual({ ok: false, reason: "empty" });
    expect(classifyQuestionFile(file("q.csv", "", MAX_QUESTION_BYTES + 1))).toEqual({ ok: false, reason: "tooLarge" });
  });
});

describe("Google Slides links", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe";
  test("reads the document id from editor and share links", () => {
    expect(parseGoogleSlidesLink(`https://docs.google.com/presentation/d/${id}/edit?usp=sharing`)).toBe(id);
    expect(parseGoogleSlidesLink(`  https://docs.google.com/presentation/u/0/d/${id}/pub `)).toBe(id);
  });

  test("refuses everything else", () => {
    for (const link of [
      "",
      "docs.google.com/presentation/d/" + id,
      `http://docs.google.com/presentation/d/${id}/edit`,
      `https://evil.example/presentation/d/${id}/edit`,
      `https://docs.google.com.evil.example/presentation/d/${id}/edit`,
      `https://user:pw@docs.google.com/presentation/d/${id}/edit`,
      "https://docs.google.com/document/d/abc/edit",
      "https://docs.google.com/presentation/d/short/edit",
    ]) {
      expect(parseGoogleSlidesLink(link)).toBeNull();
    }
  });
});

describe("small helpers", () => {
  test("formats sizes, deck links and statuses", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(42 * 1024 * 1024)).toBe("42 MB");
    expect(deckHref("64b0")).toBe("/presentation/create?id=64b0");
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("running")).toBe(false);
  });

  test("poll delays grow and settle", () => {
    expect(pollDelay(0)).toBeLessThan(pollDelay(3));
    expect(pollDelay(50)).toBe(3000);
  });
});

describe("pollImportJob", () => {
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
  const quick = { sleep: async () => {} };

  test("reports every update and resolves with the finished job", async () => {
    const script = [job("queued"), job("running", { stage: "Reading slides" }), job("completed", { resultPresentationId: "d1" })];
    const seen: string[] = [];
    const result = await pollImportJob("j1", {
      ...quick,
      fetchJob: async () => script.shift()!,
      onUpdate: (update) => seen.push(update.status),
    });
    expect(result.resultPresentationId).toBe("d1");
    expect(seen).toEqual(["queued", "running", "completed"]);
  });

  test("a failed job is a normal result", async () => {
    const result = await pollImportJob("j1", {
      ...quick,
      fetchJob: async () => job("failed", { error: { code: "INVALID_PPTX", message: "bad file" } }),
      onUpdate: () => {},
    });
    expect(result.status).toBe("failed");
  });

  test("survives a few failed reads but gives up after too many in a row", async () => {
    let calls = 0;
    const flaky = await pollImportJob("j1", {
      ...quick,
      fetchJob: async () => {
        if (++calls <= 2) throw new Error("offline");
        return job("completed");
      },
      onUpdate: () => {},
    });
    expect(flaky.status).toBe("completed");

    await expect(
      pollImportJob("j1", {
        ...quick,
        maxErrors: 3,
        fetchJob: async () => {
          throw new Error("offline");
        },
        onUpdate: () => {},
      }),
    ).rejects.toMatchObject({ reason: "errors" });
  });

  test("gives up after the deadline", async () => {
    let time = 0;
    const error = await pollImportJob("j1", {
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
      giveUpAfterMs: 5000,
      fetchJob: async () => job("running"),
      onUpdate: () => {},
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PollGaveUp);
    expect((error as PollGaveUp).reason).toBe("timeout");
  });

  test("stops when aborted", async () => {
    const controller = new AbortController();
    const promise = pollImportJob("j1", {
      sleep: async () => controller.abort(),
      signal: controller.signal,
      fetchJob: async () => job("running"),
      onUpdate: () => {},
    });
    await expect(promise).rejects.toBeDefined();
  });
});
