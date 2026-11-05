import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import {
  EMBED_RESIZE_MESSAGE,
  iframeSnippet,
  isEmbedResizeMessage,
  liveEmbedUrl,
  oembedUrl,
  resizeScript,
  resultsEmbedUrl,
  stageEmbedUrl,
} from "@/features/embeds/embedUrls";
import { normalizeSite } from "@/features/embeds/sites";
import { noticeFor } from "@/features/embeds/verdict";
import { clearEmbedPolicyCache, EMBED_POLICY_HEADER, embedsProxy, embedTargetOf } from "@/lib/proxy/embeds";
import { embedCsp, securityHeaders } from "@/lib/security/headers";

const SITE = "https://openpoll.test";
const DECK = "64b7f0c2a1b2c3d4e5f60718";
const SCREEN = `scr_${"a".repeat(43)}`;

describe("embed URLs and snippets", () => {
  test("build the three embed pages and the oEmbed address", () => {
    expect(liveEmbedUrl(SITE, "123456")).toBe(`${SITE}/embed/live/123456`);
    expect(resultsEmbedUrl(SITE, "tok_en-1")).toBe(`${SITE}/embed/results/tok_en-1`);
    expect(stageEmbedUrl(SITE, DECK, SCREEN)).toBe(`${SITE}/embed/stage/${DECK}?token=${SCREEN}`);
    expect(oembedUrl("https://api.openpoll.test", `${SITE}/embed/live/123456`)).toBe(
      "https://api.openpoll.test/api/oembed?url=https%3A%2F%2Fopenpoll.test%2Fembed%2Flive%2F123456&format=json"
    );
  });

  test("the iframe matches what oEmbed returns, escaped", () => {
    expect(iframeSnippet(`${SITE}/embed/live/1?a=1&b="2"`, 'Quiz <b>"night"</b>', "live")).toBe(
      `<iframe src="${SITE}/embed/live/1?a=1&amp;b=&quot;2&quot;" title="Quiz &lt;b&gt;&quot;night&quot;&lt;/b&gt;" ` +
        'width="420" height="640" style="border:0;max-width:100%" allow="clipboard-write; fullscreen" loading="lazy" ' +
        'referrerpolicy="strict-origin-when-cross-origin"></iframe>'
    );
    expect(iframeSnippet(`${SITE}/embed/stage/x?token=y`, "T", "stage")).toContain('width="960" height="540"');
  });

  test("the resize message is recognised and the host script only trusts our origin", () => {
    expect(isEmbedResizeMessage({ type: EMBED_RESIZE_MESSAGE, kind: "live", height: 512 })).toBe(true);
    for (const data of [null, "x", { type: EMBED_RESIZE_MESSAGE }, { type: "other", height: 1 }]) {
      expect(isEmbedResizeMessage(data)).toBe(false);
    }
    const script = resizeScript(SITE);
    expect(script).toContain(`e.origin !== "${SITE}"`);
    expect(script).toContain(`"${EMBED_RESIZE_MESSAGE}"`);
    expect(script.startsWith("<script>")).toBe(true);
  });
});

describe("embedding sites (workspace setting)", () => {
  test("normalises origins and wildcard subdomains like the API", () => {
    expect(normalizeSite("https://Example.com/")).toBe("https://example.com");
    expect(normalizeSite("intranet.example.com")).toBe("https://intranet.example.com");
    expect(normalizeSite("https://*.school.example")).toBe("https://*.school.example");
    expect(normalizeSite("http://localhost:8080")).toBe("http://localhost:8080");
  });

  test("refuses paths, other schemes and junk", () => {
    for (const value of ["", "https://example.com/page", "ftp://example.com", "https://*.com", "javascript:alert(1)", "a b"]) {
      expect(normalizeSite(value)).toBeNull();
    }
  });
});

describe("embed page verdict", () => {
  test("renders only when the proxy said so", () => {
    expect(noticeFor("allowed")).toBeNull();
    expect(noticeFor("EMBED_DISABLED")).toBe("disabled");
    expect(noticeFor("NOT_FOUND")).toBe("notFound");
    // No verdict: the proxy did not run, so nothing renders.
    expect(noticeFor(null)).toBe("notFound");
  });
});

describe("security headers", () => {
  const rule = (path: string) =>
    securityHeaders().filter((r) => new RegExp(`^${r.source.replace(/:path\*/, ".*").replace(/:path\((.*)\)$/, "$1")}$`).test(path));

  test("every page but /embed keeps frame-ancestors 'self'", () => {
    const baseline = securityHeaders()[0]!;
    expect(baseline.source).toBe("/:path((?!embed(?:/|$)).*)");
    const pattern = /^\/((?!embed(?:\/|$)).*)$/;
    for (const path of ["/", "/live/123456", "/r/token", "/home", "/embedded", "/settings/workspace"]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ["/embed", "/embed/live/123456", "/embed/stage/x"]) {
      expect(pattern.test(path), path).toBe(false);
    }
    expect(baseline.headers.find((h) => h.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'self'");
  });

  test("/embed pages get no CSP from next.config (the proxy sets it per deck)", () => {
    const embed = securityHeaders().find((r) => r.source === "/embed/:path*")!;
    expect(embed.headers.some((h) => h.key === "Content-Security-Policy")).toBe(false);
    expect(embed.headers.some((h) => h.key === "X-Content-Type-Options")).toBe(true);
    expect(rule("/embed/live/1").length).toBeGreaterThan(0);
  });

  test("the Zoom pane sends the OWASP headers Zoom checks, the Microsoft panes their frame-ancestors", () => {
    const zoom = securityHeaders().find((r) => r.source === "/addins/zoom")!;
    const keys = zoom.headers.map((h) => h.key);
    expect(keys).toEqual(["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy"]);
    const microsoft = securityHeaders().find((r) => r.source.startsWith("/addins/:path"))!;
    expect(microsoft.headers[0]!.value).toContain("https://*.officeapps.live.com");
    expect(microsoft.headers[0]!.value).toContain("https://teams.microsoft.com");
  });

  test("an embed's CSP keeps the baseline directives", () => {
    expect(embedCsp(["*"])).toBe(
      "frame-ancestors *; frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; img-src 'self' data: blob: https:"
    );
    expect(embedCsp([])).toStartWith("frame-ancestors 'self';");
    expect(embedCsp(["https://a.example", "https://*.b.example"])).toStartWith("frame-ancestors https://a.example https://*.b.example;");
  });
});

describe("embed proxy step", () => {
  const realFetch = globalThis.fetch;
  let calls: string[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: { data: { allowed: true, reason: null, frameAncestors: ["*"] } } };

  beforeEach(() => {
    calls = [];
    clearEmbedPolicyCache();
    globalThis.fetch = (async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("reads the target from the path", () => {
    expect(embedTargetOf("/embed/live/123456", new URLSearchParams())).toEqual({ kind: "live", id: "123456", token: null });
    expect(embedTargetOf(`/embed/stage/${DECK}`, new URLSearchParams({ token: SCREEN }))).toEqual({ kind: "stage", id: DECK, token: SCREEN });
    expect(embedTargetOf("/embed/results/abc/", new URLSearchParams({ token: "x" }))).toEqual({ kind: "results", id: "abc", token: null });
    expect(embedTargetOf("/embed/other/1", new URLSearchParams())).toBeNull();
    expect(embedTargetOf("/embed/live/1/2", new URLSearchParams())).toBeNull();
  });

  test("leaves every other page alone", async () => {
    expect(await embedsProxy(new NextRequest("http://localhost:3000/live/123456"))).toBeUndefined();
    expect(await embedsProxy(new NextRequest("http://localhost:3000/embedded"))).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("lets the allowed sites frame an allowed embed and tells the page", async () => {
    answer = { status: 200, body: { data: { allowed: true, reason: null, frameAncestors: ["https://a.example"] } } };
    const response = await embedsProxy(new NextRequest(`http://localhost:3000/embed/stage/${DECK}?token=${SCREEN}`));
    expect(response?.headers.get("content-security-policy")).toStartWith("frame-ancestors https://a.example;");
    expect(response?.headers.get("x-middleware-request-" + EMBED_POLICY_HEADER)).toBe("allowed");
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`/api/embeds/policy?kind=stage&id=${DECK}&token=${SCREEN}`);
  });

  test("keeps a denied embed to this site and says why", async () => {
    answer = { status: 200, body: { data: { allowed: false, reason: "EMBED_DISABLED", frameAncestors: [] } } };
    const response = await embedsProxy(new NextRequest("http://localhost:3000/embed/live/123456"));
    expect(response?.headers.get("content-security-policy")).toStartWith("frame-ancestors 'self';");
    expect(response?.headers.get("x-middleware-request-" + EMBED_POLICY_HEADER)).toBe("EMBED_DISABLED");
  });

  test("fails closed when the API errors, and asks again next time", async () => {
    answer = { status: 500, body: {} };
    const first = await embedsProxy(new NextRequest("http://localhost:3000/embed/live/123456"));
    expect(first?.headers.get("content-security-policy")).toStartWith("frame-ancestors 'self';");
    answer = { status: 200, body: { data: { allowed: true, reason: null, frameAncestors: ["*"] } } };
    const second = await embedsProxy(new NextRequest("http://localhost:3000/embed/live/123456"));
    expect(second?.headers.get("content-security-policy")).toStartWith("frame-ancestors *;");
    // Cached now.
    await embedsProxy(new NextRequest("http://localhost:3000/embed/live/123456"));
    expect(calls).toHaveLength(2);
  });

  test("a malformed embed path is not found and never framed", async () => {
    const response = await embedsProxy(new NextRequest("http://localhost:3000/embed/nothing"));
    expect(response?.headers.get("content-security-policy")).toStartWith("frame-ancestors 'self';");
    expect(response?.headers.get("x-middleware-request-" + EMBED_POLICY_HEADER)).toBe("NOT_FOUND");
    expect(calls).toEqual([]);
  });
});
