import { FAQS } from "@/features/landing/content";

import { FEATURES } from "./json-ld";
import { absoluteUrl, publicPage, SITE_NAME, SITE_TAGLINE } from "./site";

/**
 * `/llms.txt` (https://llmstxt.org): a plain Markdown brief of the product for
 * AI assistants and answer engines, built from the same facts as the landing
 * page, its FAQ and the sitemap.
 */
export function buildLlmsTxt(): string {
  const link = (path: string, note: string) => {
    const page = publicPage(path);
    const title = path === "/" ? SITE_NAME : page.title;
    return `- [${title}](${absoluteUrl(path)}): ${note}`;
  };

  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_TAGLINE} ${SITE_NAME} is a web app for live polls, quizzes, word clouds and Q&A in presentations. ` +
      "A presenter builds a deck of interactive slides (or lets AI draft one), shares a join code, and the audience " +
      "answers from their phones while the results appear live on the shared screen.",
    "",
    "Presenters need an account. Participants join with the session's code or QR code and a nickname, without an " +
      "account. There is a free plan with a smaller audience and fewer AI and import runs; paid plans raise those limits.",
    "",
    "## What it does",
    "",
    ...FEATURES.map((feature) => `- ${feature}`),
    "",
    "## Pages",
    "",
    link("/", "What Open Poll is: question types, how a session works, features, pricing and the FAQ."),
    link("/live", publicPage("/live").description),
    link("/signup", publicPage("/signup").description),
    link("/login", publicPage("/login").description),
    "",
    "## FAQ",
    "",
    ...FAQS.flatMap((item) => [`### ${item.q}`, "", item.a, ""]),
    "## Optional",
    "",
    link("/privacy", publicPage("/privacy").description),
    link("/terms", publicPage("/terms").description),
    "",
  ].join("\n");
}
