import { afterEach, describe, expect, test } from "bun:test";

import { newClientAnswerId } from "@/features/presentations/live/answerId";

// The idempotency key of one answer attempt: ≤ 64 chars, unique per call, and
// available where crypto.randomUUID is not (plain-http phones).

describe("newClientAnswerId", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  });

  test("is short enough for the server and different every time", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newClientAnswerId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test("works without crypto.randomUUID (insecure contexts)", () => {
    Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: crypto.getRandomValues.bind(crypto) }, configurable: true });
    expect(newClientAnswerId()).toMatch(/^[0-9a-f]{32}$/);
  });

  test("falls back to Math.random without any crypto", () => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    expect(newClientAnswerId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
