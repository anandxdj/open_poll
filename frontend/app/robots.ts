import type { MetadataRoute } from "next";

import { absoluteUrl, AI_CRAWLERS, CRAWL_DISALLOW, getSiteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const rule = { allow: "/", disallow: CRAWL_DISALLOW };
  return {
    // A crawler named in its own group ignores the `*` group, so the AI group repeats the rules.
    rules: [
      { userAgent: "*", ...rule },
      { userAgent: AI_CRAWLERS, ...rule },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: getSiteUrl().origin,
  };
}
