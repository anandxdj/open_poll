import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { FAQS } from "@/features/landing/content";
import { landingJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { AI_CRAWLERS, CRAWL_DISALLOW, getSiteUrl, pageMetadata, PUBLIC_PAGES } from "@/lib/seo/site";

const SITE = "https://openpoll.example";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = saved;
});

describe("site URL", () => {
  test("comes from NEXT_PUBLIC_SITE_URL, with localhost when unset or invalid", () => {
    expect(getSiteUrl().origin).toBe(SITE);
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(getSiteUrl().origin).toBe("http://localhost:3000");
    process.env.NEXT_PUBLIC_SITE_URL = "not a url";
    expect(getSiteUrl().origin).toBe("http://localhost:3000");
  });
});

describe("robots.txt", () => {
  test("keeps every crawler, AI crawlers included, out of the signed-in app and points at the sitemap", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    expect(rules.map((r) => r.userAgent)).toEqual(["*", AI_CRAWLERS]);
    for (const rule of rules) {
      expect(rule.allow).toBe("/");
      expect(rule.disallow).toEqual(CRAWL_DISALLOW);
    }
    expect(result.sitemap).toBe(`${SITE}/sitemap.xml`);
  });

  test("does not block public pages or share links that carry noindex", () => {
    const blocked = (path: string) => CRAWL_DISALLOW.some((prefix) => path.startsWith(prefix));
    for (const page of PUBLIC_PAGES) expect(blocked(page.path)).toBe(false);
    for (const path of ["/live", "/llms.txt", "/live/123456", "/p/abc", "/r/token", "/terms"]) {
      expect(blocked(path)).toBe(false);
    }
    for (const path of ["/polls", "/settings/billing", "/presentation/host/1", "/presentations/1", "/api/plans"]) {
      expect(blocked(path)).toBe(true);
    }
  });
});

describe("sitemap", () => {
  test("lists every public page once, as absolute URLs on the site origin", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(PUBLIC_PAGES.map((page) => new URL(page.path, SITE).toString()));
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("page metadata", () => {
  test("sets the canonical URL and a page's own social card title", () => {
    const live = pageMetadata("/live");
    expect(live.title).toBe("Join a session");
    expect(live.alternates?.canonical).toBe("/live");
    expect(live.openGraph?.title).toBe("Join a session | Open Poll");
    expect(live.openGraph && "url" in live.openGraph ? live.openGraph.url : null).toBe("/live");
  });

  test("leaves the home page on the root title", () => {
    expect(pageMetadata("/").title).toBeUndefined();
  });

  test("throws for a path that is not a public page", () => {
    expect(() => pageMetadata("/polls")).toThrow();
  });
});

describe("JSON-LD", () => {
  test("describes the organisation, site, app and every FAQ entry", () => {
    const data = landingJsonLd();
    const types = data["@graph"].map((node) => node["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebApplication", "FAQPage"]);
    const faq = data["@graph"][3] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(FAQS.map((item) => item.q));
    expect(faq.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(FAQS.map((item) => item.a));
    expect(data["@graph"][0]).toMatchObject({ url: `${SITE}/` });
  });

  test("escapes < so the data cannot close its script tag", () => {
    const json = serializeJsonLd({ text: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("<");
    expect(JSON.parse(json).text).toBe("</script><script>alert(1)</script>");
  });
});

describe("llms.txt", () => {
  test("is a Markdown brief with the public pages and the whole FAQ", () => {
    const text = buildLlmsTxt();
    expect(text.startsWith("# Open Poll\n\n> ")).toBe(true);
    for (const path of ["/", "/live", "/signup", "/login", "/privacy", "/terms"]) {
      expect(text).toContain(`](${new URL(path, SITE).toString()})`);
    }
    for (const item of FAQS) {
      expect(text).toContain(`### ${item.q}`);
      expect(text).toContain(item.a);
    }
  });
});
