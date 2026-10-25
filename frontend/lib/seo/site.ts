import type { Metadata, MetadataRoute } from "next";

// Public facts about the site, shared by page metadata, robots.txt, the
// sitemap, the web manifest, JSON-LD and llms.txt so they never disagree.

export const SITE_NAME = "Open Poll";
export const SITE_TITLE = "Open Poll — Live polls, quizzes and Q&A";
export const SITE_TAGLINE = "Slides your audience can answer.";
export const SITE_DESCRIPTION =
  "Build decks of polls, quizzes, word clouds and Q&A, or draft one with AI. Your audience joins with a code and answers live.";

const FALLBACK_URL = "http://localhost:3000";

/** Canonical origin of the site (`NEXT_PUBLIC_SITE_URL`), used for every absolute URL. */
export function getSiteUrl(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || FALLBACK_URL);
  } catch {
    return new URL(FALLBACK_URL);
  }
}

export function absoluteUrl(path: string): string {
  return new URL(path, getSiteUrl()).toString();
}

export interface PublicPage {
  path: string;
  title: string;
  description: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}

/** Pages anyone can open and search engines should index: the sitemap and llms.txt list them. */
export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/live",
    title: "Join a session",
    description:
      "Enter the code on the presenter's screen to answer live polls, quizzes and Q&A from your phone. No account needed.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/signup",
    title: "Sign up",
    description: "Create a free Open Poll account to build decks of live polls, quizzes, word clouds and Q&A.",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    path: "/login",
    title: "Log in",
    description: "Log in to Open Poll to build, present and review your live polls, quizzes and Q&A.",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    path: "/privacy",
    title: "Privacy",
    description: "How Open Poll collects, uses and protects the data of presenters and participants.",
    changeFrequency: "yearly",
    priority: 0.2,
  },
  {
    path: "/terms",
    title: "Terms of use",
    description: "The terms for using Open Poll to build and run live sessions.",
    changeFrequency: "yearly",
    priority: 0.2,
  },
];

export function publicPage(path: string): PublicPage {
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`No public page for ${path}`);
  return page;
}

/**
 * The signed-in app and hosting routes. Signed-out crawlers are only
 * redirected to /login there, so robots.txt keeps them out. Share links
 * (`/p/`, `/r/`, `/live/<code>`, invitations) are not listed: they carry a
 * noindex tag instead, which crawlers can only see if they may fetch the page.
 */
export const CRAWL_DISALLOW = ["/polls", "/create", "/settings", "/analytics", "/presentation", "/auth/", "/test", "/api/"];

/**
 * AI search, assistant and training crawlers. They get the same rules as
 * every other crawler; naming them keeps the policy explicit and easy to change.
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "Meta-ExternalAgent",
  "DuckAssistBot",
  "MistralAI-User",
  "CCBot",
];

/** For pages that must stay out of search results (private, per-person or one-off links). */
export const NO_INDEX: Metadata["robots"] = { index: false, follow: false };

/**
 * Title, description, canonical URL and social cards for one public page.
 * Open Graph and Twitter fields are set per page because a child segment's
 * `title` does not reach the inherited `og:title`.
 */
export function pageMetadata(path: string): Metadata {
  const page = publicPage(path);
  const fullTitle = path === "/" ? page.title : `${page.title} | ${SITE_NAME}`;
  return {
    ...(path === "/" ? {} : { title: page.title }),
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: fullTitle,
      description: page.description,
    },
    twitter: { card: "summary_large_image", title: fullTitle, description: page.description },
  };
}
