# Search and AI visibility

How Open Poll describes itself to search engines, social previews and AI
assistants. Everything is built from `lib/seo/site.ts`, so titles, the sitemap,
robots.txt, JSON-LD and llms.txt never disagree.

## Site URL

`NEXT_PUBLIC_SITE_URL` (see `.env.example`) is the public origin, read at build
time. It is the root layout's `metadataBase` and the base of every absolute URL
(canonical links, sitemap, robots.txt, social images, JSON-LD, llms.txt). Unset
or invalid, it falls back to `http://localhost:3000`, so **production builds
must set it**.

## `lib/seo/site.ts`

| Export | Use |
| --- | --- |
| `SITE_NAME`, `SITE_TITLE`, `SITE_TAGLINE`, `SITE_DESCRIPTION` | Root metadata, manifest, JSON-LD, llms.txt, the social card. |
| `PUBLIC_PAGES` | The indexable pages (`/`, `/live`, `/signup`, `/login`, `/privacy`, `/terms`) with title, description, sitemap frequency and priority. Add a public page here first. |
| `pageMetadata(path)` | Title, description, canonical and the page's own Open Graph / X title and description for a `PUBLIC_PAGES` entry (throws for any other path). Set per page because a child's `title` does not reach the inherited `og:title`. |
| `NO_INDEX` | `robots: { index: false, follow: false }` for private pages. |
| `CRAWL_DISALLOW` | robots.txt `Disallow` prefixes: the signed-in app and hosting routes (`/polls`, `/create`, `/settings`, `/analytics`, `/presentation`, `/auth/`, `/test`, `/api/`). |
| `AI_CRAWLERS` | AI search, assistant and training crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot…), given the same rules as everyone else. |

## Indexing rules

- **Indexed**: the `PUBLIC_PAGES`. The landing, `/live`, `/privacy` and `/terms`
  use `pageMetadata`; `/login` and `/signup` too, opting back in to indexing
  because the `(auth)` group layout is noindex.
- **noindex** (`NO_INDEX` in a layout or page): the `(dashboard)` group, the host
  console, `(auth)` one-off links (forgot, reset, verify), `/auth/complete`,
  `/test`, and share links: `/live/[code]` (and its summary), `/p/[id]`,
  `/r/[token]`, `/invites/[token]`.
- Share links are not in robots.txt on purpose: a crawler has to fetch the page
  to see its noindex. They keep a social card that reads as an invitation
  ("Join the live session", "Answer this poll").
- A layout with a plain string `title` ends the root title template for its
  children, so `/live/[code]` sets `title: { absolute, template }` itself.

## Metadata routes

| Route | File | Notes |
| --- | --- | --- |
| `/robots.txt` | `app/robots.ts` | `*` and the AI crawlers: allow `/`, disallow `CRAWL_DISALLOW`, sitemap link. A crawler named in its own group ignores `*`, hence the repeat. |
| `/sitemap.xml` | `app/sitemap.ts` | `PUBLIC_PAGES` as absolute URLs. No `lastModified` (no real dates to give). |
| `/manifest.webmanifest` | `app/manifest.ts` | Name, colours (paper), the SVG mark and the 180px touch icon. |
| `/opengraph-image`, `/twitter-image` | `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `lib/seo/og-image.tsx` | 1200×630 PNG, prerendered at build: the hero headline on graph paper beside a sample result, in Inter Tight, Instrument Serif and JetBrains Mono fetched from Google Fonts as TrueType at build time (the default font if that fails). Used by every page that does not set its own. |
| `/llms.txt` | `app/llms.txt/route.ts`, `lib/seo/llms.ts` | Static Markdown brief for AI assistants (llmstxt.org): summary, features, public pages, the whole FAQ. |

The root layout also sets `applicationName`, keywords, category, the default
Open Graph / X card (`summary_large_image`), `formatDetection` off and the
`theme-color` for light (`#f6f6f3`) and dark (`#141413`).

## Structured data (`lib/seo/json-ld.ts`)

`app/page.tsx` renders one `application/ld+json` script with an `@graph`:
`Organization`, `WebSite`, `WebApplication` (description, `FEATURES`, the free
plan as an `Offer` at 0) and `FAQPage` built from `features/landing/content.ts`.
`serializeJsonLd` escapes `<`. Only claims the landing page makes go here; paid
prices come from the billing API and are not listed.

## Content crawlers can read

The landing is a client component but server-rendered, so its copy is in the
HTML. The FAQ keeps closed answers in the DOM (`hidden`), so crawlers that do
not run scripts still read them. One `h1` per page.

## Tests

`tests/unit/seo.test.ts`: site URL fallback, robots rules (public pages and
share links not blocked, the app blocked), sitemap URLs, `pageMetadata`,
JSON-LD shape and escaping, llms.txt pages and FAQ.
