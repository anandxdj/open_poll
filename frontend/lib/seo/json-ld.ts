import { FAQS } from "@/features/landing/content";

import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "./site";

// schema.org structured data for the landing page: who makes Open Poll, what
// the app is and does, and the FAQ. Search engines and AI answer engines read
// it to describe the product; every claim here is one the landing page makes.

/** What the product does, each backed by the landing page and its FAQ. */
export const FEATURES = [
  "Live multiple choice polls and scored quizzes with a leaderboard",
  "Typed answers, word clouds and open-ended responses",
  "Scales, rankings, number guesses, 100-point splits, 2 by 2 grids and pins on an image",
  "Audience Q&A with upvotes and emoji reactions",
  "Audience joins with a code or QR code, no account needed",
  "AI drafts a whole deck from a topic, with speaker notes",
  "Import PowerPoint, PDF, Google Slides, CSV and Excel",
  "Session reports with CSV export and read-only results links",
  "Team workspaces with roles and an audit log",
];

export function landingJsonLd() {
  const home = absoluteUrl("/");
  const organization = { "@id": `${home}#organization` };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        ...organization,
        name: SITE_NAME,
        url: home,
        logo: absoluteUrl("/logo-openpoll.png"),
      },
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        name: SITE_NAME,
        url: home,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: organization,
      },
      {
        "@type": "WebApplication",
        "@id": `${home}#app`,
        name: SITE_NAME,
        url: home,
        description: SITE_DESCRIPTION,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Audience response",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript",
        featureList: FEATURES,
        // Only the free plan has a fixed price; paid prices come from the billing API.
        offers: { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
        publisher: organization,
      },
      {
        "@type": "FAQPage",
        "@id": `${home}#faq`,
        mainEntity: FAQS.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so the data cannot close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
