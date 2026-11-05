import { afterEach, describe, expect, test } from "bun:test";

import { customDomainAction, isPrimaryHost } from "@/features/domains/hosts";
import { domainsProxy } from "@/lib/proxy/domains";
import { NextRequest } from "next/server";

describe("custom domain hosts", () => {
  test("the site's own, local and preview hosts are primary", () => {
    expect(isPrimaryHost("localhost:3000")).toBe(true);
    expect(isPrimaryHost("127.0.0.1:3103")).toBe(true);
    expect(isPrimaryHost("app.localhost")).toBe(true);
    expect(isPrimaryHost("open-poll-git-x.vercel.app")).toBe(true);
    expect(isPrimaryHost("openpoll.example", "openpoll.example, www.openpoll.example")).toBe(true);
    expect(isPrimaryHost("polls.acme.test", "openpoll.example")).toBe(false);
  });

  test("a custom domain serves joining, live, results, embeds, polls and assets; the rest goes home", () => {
    expect(customDomainAction("/")).toBe("join");
    for (const path of ["/live", "/live/123456", "/live/123456/summary", "/r/abc", "/embed/results/x", "/p/1", "/_next/static/a.js", "/logo-openpoll.svg"]) {
      expect([path, customDomainAction(path)]).toEqual([path, "pass"]);
    }
    for (const path of ["/polls", "/settings/sso", "/login", "/presentation/create"]) {
      expect([path, customDomainAction(path)]).toEqual([path, "redirect"]);
    }
  });
});

describe("custom domain proxy step", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.NEXT_PUBLIC_CUSTOM_DOMAINS;
  });

  const request = (url: string) => new NextRequest(url, { headers: { host: new URL(url).host } });

  test("does nothing unless switched on, or on the main site", async () => {
    expect(await domainsProxy(request("https://polls.acme.test/polls"))).toBeUndefined();
    process.env.NEXT_PUBLIC_CUSTOM_DOMAINS = "on";
    expect(await domainsProxy(request("http://localhost:3000/polls"))).toBeUndefined();
  });

  test("rewrites / to the join page, passes participant pages, sends the rest to the main site", async () => {
    process.env.NEXT_PUBLIC_CUSTOM_DOMAINS = "on";
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ data: {} }), { status: url.includes("polls.acme.test") ? 200 : 404 });
    }) as unknown as typeof fetch;

    const join = (await domainsProxy(request("https://polls.acme.test/")))!;
    expect(join.headers.get("x-middleware-rewrite")).toBe("https://polls.acme.test/live");
    expect(await domainsProxy(request("https://polls.acme.test/live/123456"))).toBeUndefined();
    const away = (await domainsProxy(request("https://polls.acme.test/settings?x=1")))!;
    expect([away.status, away.headers.get("location")]).toEqual([308, "http://localhost:3000/settings?x=1"]);
    const unknown = (await domainsProxy(request("https://evil.test/live")))!;
    expect([unknown.status, unknown.headers.get("location")]).toEqual([307, "http://localhost:3000/"]);
    // One lookup per host a minute.
    expect(asked.filter((u) => u.includes("polls.acme.test"))).toHaveLength(1);
  });
});
