---
summary: Product vision and positioning for the Mentimeter-competitive pivot. Conference/presenter audience, SaaS ambition.
status: draft
last_updated: 2026-06-10
---

# Product Vision — Interactive Presentation Platform

## One-line positioning

> A live, interactive **presentation** tool for speakers — where every slide can ask the
> room a question, and the answers appear on screen in real time.

We compete with **Mentimeter** and **Slido** in the conference / keynote / workshop segment.
Not Kahoot (classroom game-show) and not SurveyMonkey (async forms) — though we touch both.

## Who we serve (in priority order)

1. **Conference & keynote speakers** — want the audience engaged during a talk, beautiful
   visuals on the big screen, zero-friction join (QR / short code, no app install).
2. **Workshop facilitators & trainers** — want word clouds, scales, ranking, Q&A, and to run
   the same deck across many sessions and compare results.
3. **Internal-comms / town-hall hosts** — want anonymous audience input, moderated Q&A, and
   exportable reports — under a company workspace with SSO.

The participant ("the audience") is a first-class but **unauthenticated, ephemeral** user.
The paying customer is the **presenter / their organization**.

## The strategic reframe (the core bet)

Today the product is **two disconnected silos**:

- `polls` — asynchronous voting forms (create, share a link, collect responses over time).
- `quizzes` — a live, presenter-paced competition state machine
  (`draft → lobby → question ⇄ reveal ⇄ leaderboard → ended`).

Mentimeter is **neither and both**: it is a **deck of slides** where each slide is either
*content* (heading, image, big number, quote, video) or *interactive* (poll, word cloud,
open text, scales, ranking, quiz). One presenter clicks through one linear deck. Some slides
collect answers; some just display.

**The bet:** unify polls + quizzes into a single first-class entity — a **Presentation**
(working name) — that:

- is an **ordered list of slides**, each with a `type` (content or interactive);
- supports a **pace** setting: *presenter-paced* (reuse the quiz state machine) or
  *audience-paced* (reuse the async poll flow);
- runs the existing Redis-first live engine for interactive slides regardless of pace.

We already own ~80% of the hard parts: the live state machine, server-clock scoring,
Redis hot path, six interactive slide types, sanitized broadcasts, participant tokens.
What is missing is the **container that joins them** and the **content slide types** that
let a whole talk live in the tool.

> If we build only more slide types and never unify, we stay a "quiz app with extra modes."
> The unification is what makes us a *presentation* product a speaker would actually present from.

### What changes for a specific person when this ships

A speaker preparing a 30-minute keynote opens one deck. Slide 3 is a title card, slide 4 is a
live word cloud ("one word for how onboarding feels today"), slides 5–8 are content, slide 9 is
a ranked poll, slide 12 is a quiz to wake the room up, the last slide shows a Q&A board with
upvoted questions. They present the whole thing from our presenter view with speaker notes and a
phone remote — never alt-tabbing to PowerPoint. Today that speaker cannot do this in our tool;
they would run the talk in PowerPoint and bolt on a separate Mentimeter.

## How we win (differentiation, not just parity)

Parity gets us considered; these get us chosen. Pick a small number and do them better:

- **Beautiful reveals.** The big-screen moment (word cloud forming, bars racing, leaderboard
  podium) is the product's "wow." Invest in motion + typography here disproportionately.
- **Offline resilience.** Conference Wi-Fi is hostile. Graceful degradation, reconnect-without-
  data-loss, and a "results cached, will sync" state are a real wedge against Mentimeter's
  occasionally-fragile live experience.
- **AI deck authoring.** We already generate quizzes from a topic. Extend to *whole decks*
  (content + interactive mixed) from a talk abstract — a genuinely faster authoring path.
- **Speaker-grade presenter view.** Notes, next-slide preview, timer, response counts,
  phone-as-remote. Slido/Menti treat the presenter view as secondary; we make it primary.

## The SaaS shape (because: serious SaaS, multi-tenant)

This audience + ambition implies platform plumbing that does not exist yet:

- **Workspaces / teams** as the tenancy boundary. Presentations belong to a workspace, not a
  bare user. Today everything is keyed on a single `creatorId`.
- **Roles** — owner / admin / editor / presenter / viewer.
- **Plans & billing** — free / pro / team / enterprise with feature gates
  (audience size caps, export, branding, SSO, retention).
- **SSO (SAML / OIDC)** and **SCIM** for the enterprise/town-hall buyer.
- **Templates, folders, sharing, co-editing.**
- **Compliance basics** — audience anonymity guarantees, data export/delete, retention windows
  (GDPR). For anonymous polls this is also a *trust* feature we can market.

These are sequenced in `01-competitive-roadmap.md`. They are deliberately **after** the
unification + a hardened core, because tenancy is far cheaper to introduce before there are
paying tenants and far more valuable once the core experience is worth paying for.

## Success metrics (what "working" means)

| Layer | Metric | Why |
| --- | --- | --- |
| Activation | % of new presenters who run ≥1 live session within 7 days | Proves the core loop lands |
| Engagement | Median audience response rate per interactive slide | The product's actual job |
| Retention | % of presenters who run a 2nd session within 30 days | Repeat use = real value |
| Reliability | p95 answer-submit latency < 150ms; live-session error rate < 0.5% | Conference stakes are high |
| Integrity | Detected duplicate/fraudulent votes per session ≈ 0 | The whole value prop (see security doc) |
| Revenue | Free→paid conversion; seats per paying workspace | SaaS viability |

## Durability — does the bet survive the next 18 months?

- **AI eats presentations?** AI-native deck tools (Gamma, etc.) are rising. Our moat is the
  *live audience interaction*, which is orthogonal to static deck generation — and we can ride the
  trend by being the best AI-authored *interactive* deck. Risk if a Gamma-like adds strong live
  interaction; mitigate by leading on the live/reveal craft and offline resilience they will not
  prioritize early.
- **Mentimeter/Slido ship the same features.** They already have most parity features; we will not
  out-feature them. We win on a *segment-specific* better experience (presenter view, reveals,
  offline) and price, not breadth. This must stay true — do not chase their entire surface area.
- **Open assumption (unverified):** that conference presenters are dissatisfied enough with
  incumbents to switch. We have not validated this with real presenters. Treat early design-partner
  talks as the cheapest way to de-risk before heavy investment in tenancy/billing.

## Explicitly out of scope (for this product's identity)

- Full LMS / gradebook (that is Kahoot/edu territory; we touch reports, not grading workflows).
- General-purpose survey panels / market-research distribution.
- Async long-form forms (Typeform territory) beyond the existing simple poll links.

## Open product questions to resolve before/within planning

1. **Naming & IA:** do "polls" and "quizzes" survive as user-facing concepts, or does everything
   become "Presentations" with slide types? (Recommend: unify to Presentations; keep "quiz mode"
   as a deck setting.)
2. **Migration:** existing polls/quizzes → presentations. One-time data migration vs. dual-read
   compatibility window.
3. **Tenancy timing:** introduce workspaces before or after the unification ships? (Recommend:
   model the workspace boundary in the unification schema even if the UI exposes a single default
   workspace at first — retrofitting tenancy later is expensive.)
