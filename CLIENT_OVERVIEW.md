# Open Poll — Client Product Overview

**Prepared for:** Client Review & Requirements Gathering
**Date:** June 2026
**Version:** 1.0

---

## What Is Open Poll?

Open Poll is a **live audience engagement platform** built for presenters, speakers, trainers, and event hosts. It lets you build an interactive presentation where your audience participates in real time — answering questions, voting in polls, joining quizzes, and submitting questions — all from their phones or laptops, without downloading anything.

Think of it as the tool that turns a one-way presentation into a two-way conversation with your audience.

---

## The Problem It Solves

Today, a speaker preparing a keynote or workshop typically uses:

- **PowerPoint or Keynote** — for their slides and content
- **A separate polling tool** (like Mentimeter or Slido) — bolted on for audience interaction
- Manual follow-up to pull together results and share them

This is fragmented. The speaker alt-tabs between tools, the experience is patchy, and the audience interaction feels like an afterthought rather than part of the presentation.

**Open Poll solves this by putting everything in one place** — the whole talk, from title slide to Q&A, lives in a single tool. The presenter controls the flow. The audience participates live.

---

## Who Is This For?

### Primary Users (Paying Customers)

| Who | What They Need |
|---|---|
| **Conference & keynote speakers** | Audience engagement during a live talk, beautiful visuals on the big screen, zero friction for the audience to join |
| **Workshop facilitators & trainers** | Word clouds, ratings, rankings, open-ended questions, and the ability to reuse the same deck across many sessions |
| **Internal comms & town hall hosts** | Anonymous audience input, a moderated Q&A wall, and exportable reports — ideally under a company account with single sign-on |

### Secondary Users (Participants / The Audience)

The audience joins via a QR code or short link — no app download, no account required. They are a first-class experience in the product but not the paying customer.

---

## Core Features

### For the Presenter

- **Presentation builder** — create a deck of slides. Each slide is either a content slide (title, text, image, video) or an interactive slide (poll, quiz, word cloud, Q&A, etc.).
- **Presenter view** — a dedicated screen showing speaker notes, a preview of the next slide, a live timer, and real-time response counts — so the presenter never loses control of the room.
- **Phone as remote** — control the presentation from your phone while the big screen shows the audience view.
- **AI-assisted deck creation** — describe your talk topic or paste an abstract, and the platform drafts a full interactive deck for you to refine.
- **Session history** — run the same deck at multiple events and compare results across sessions.
- **Export** — download results as a spreadsheet or PDF report after the session.

### For the Audience

- **One-tap join** — scan a QR code or type a short code. No app, no account, no friction.
- **Live participation** — answer polls, type responses, vote in quizzes, and upvote questions from others.
- **Take-home summary** — receive a personal results summary after the session.

### Interactive Slide Types Available

| Type | What It Does |
|---|---|
| **Multiple choice poll** | Audience picks one or more options; results appear as a live bar chart |
| **Word cloud** | Audience types a word or phrase; common answers grow bigger on screen |
| **Open text wall** | Free-text responses displayed live on screen |
| **Rating scale** | Audience rates something on a 1–5 or 1–10 scale |
| **Ranking** | Audience orders items by preference; aggregate ranking shown |
| **Quiz (competitive)** | Timed questions with a live leaderboard |
| **Q&A board** | Audience submits questions, others upvote them; presenter moderates and marks answered |
| **Live reactions** | Audience sends emoji reactions that burst across the screen in real time |

---

## What Makes It Different

There are established players in this space (Mentimeter, Slido, Kahoot). Here is where Open Poll competes differently:

**1. Beautiful live reveals**
The moment a word cloud forms or a leaderboard animates on the big screen is the product's signature experience. This is invested in disproportionately — motion, typography, and drama on the reveal moment.

**2. Works when the Wi-Fi doesn't**
Conference venue Wi-Fi is notoriously unreliable. Open Poll is built to degrade gracefully — if a participant loses connection, their answer is held and synced when the connection recovers. The presenter never loses a response.

**3. AI deck authoring**
Most tools help you collect responses. Open Poll helps you build the whole deck — paste a talk abstract and get a mixed content-and-interactive slide deck back in seconds, ready to customize.

**4. A genuine presenter view**
Mentimeter and Slido treat the presenter screen as secondary. Open Poll makes it primary — full speaker notes, next-slide preview, response counts, timer, and remote control from your phone.

---

## Product Roadmap (Phased)

The product is built in clearly defined phases. Earlier phases are foundations; later phases are growth and monetization.

### Phase 0 — Security & Trust (Launch Gate)
Before any real audience can use the platform, vote integrity must be bulletproof. This phase ensures no duplicate votes, tamper-proof results, and proper authentication controls. Non-negotiable before launch.

### Phase 1 — Unified Presentation (Core, Now)
Merge the current separate "polls" and "quizzes" into a single **Presentation** — an ordered deck of mixed slides. This is the most important architectural step and the prerequisite for everything else.

### Phase 2 — Content Slides
Add non-interactive slides: headings, text, images, big numbers, quotes, video embeds. This lets a presenter's entire talk — not just the interactive moments — live in the tool.

### Phase 3 — Presenter Experience
Dedicated presenter view, phone remote, fullscreen polish, timer controls, ability to pause or skip slides.

### Phase 4 — Q&A + Reactions
Audience Q&A board with upvoting and presenter moderation queue. Live emoji reactions. These are flagship features for the conference segment.

### Phase 5 — Session History & Export
Each time you run a deck, save it as a separate session. Compare across sessions. Export reports. Share a read-only results link. Give participants a take-home page.

### Phase 6 — Themes & Branding
Customizable colors, fonts, logos, and background images. A brand kit for teams. Natural upgrade feature.

### Phase 7 — Import & AI Deck Authoring
Import an existing PowerPoint, PDF, or Google Slides deck and convert it into an editable interactive presentation. Extend AI authoring from quizzes to full mixed decks.

### Phase 8 — Scale & Reliability
Built to handle thousands of simultaneous audience members. Load-tested infrastructure, resilient connections, and monitoring dashboards. Required before large enterprise events.

### Phase 9 — SaaS Platform (Teams, Billing, SSO)
Team workspaces, role-based access (owner, editor, presenter, viewer), subscription plans with feature limits, enterprise single sign-on (Google, Microsoft, SAML), and compliance features (GDPR data export/delete, audit logs).

### Phase 10 — Accessibility, Localization, Compliance
Full accessibility support (keyboard navigation, screen reader compatibility), participant interface in multiple languages, and documented privacy and data compliance.

### Phase 11 — Integrations
Zoom and Microsoft Teams plugins, PowerPoint add-in, embeddable live view, custom domains for white-label use.

---

## Business Model

| Plan | Who It's For |
|---|---|
| **Free** | Individuals testing the product; limited audience size and features |
| **Pro** | Individual presenters who run regular sessions; full slide types, exports, session history |
| **Team** | Organizations with multiple presenters sharing a workspace, branding, and reports |
| **Enterprise** | Large organizations needing SSO, compliance, audit logs, and a dedicated account |

Feature gates (audience size caps, branding, export, SSO) are the levers between plans.

---

## What Is Already Built

The following is working and live today:

- Real-time polling with live chart updates
- Six interactive slide types (multiple choice, word cloud, open text, scales, ranking, quiz)
- Presenter-paced quiz with lobby, live questions, leaderboard, and end state
- Participant join via link with no account required
- Google and email authentication for presenters
- AI quiz generation from a topic
- Basic CSV export for polls

---

## What We Need from You (Requirements Questions)

To make sure the product is built to your specific needs, we'd like to understand:

1. **Who is your primary audience?** Conference speakers, corporate trainers, educators, event organizers — or a mix?
2. **How large are your typical audiences?** Under 50, 50–500, or 500+?
3. **Do your events happen in venues with reliable Wi-Fi?** This affects how much we prioritize offline resilience.
4. **Is branding / white-labeling important?** Do you need to remove Open Poll branding or apply your own?
5. **Do you need team accounts?** Will multiple people in your organization be creating presentations?
6. **Is enterprise single sign-on (SSO) required?** For example, logging in with a company Microsoft or Google account.
7. **What does success look like after 90 days?** Number of sessions run, participants engaged, or something else?
8. **Are there compliance requirements?** GDPR, data residency, SOC 2, or similar?

---

## What We Are Not Building

To be clear about scope:

- **Not an LMS or gradebook** — results are for presenters and audience engagement, not student grading or course management.
- **Not a long-form survey tool** — this is for live, in-the-room sessions, not multi-day or market research panels.
- **Not a general form builder** — Typeform-style workflows are out of scope.

---

## Summary

Open Poll is a live presentation and audience engagement platform targeting speakers, trainers, and event hosts who need a single tool that combines their slides, their live interactive moments, and their post-session reports. The core bet is that presenters are tired of juggling PowerPoint and a separate polling bolt-on — and that a purpose-built, beautifully crafted alternative with strong offline resilience, AI authoring, and a genuine presenter view can earn their loyalty.

The product is in active development, with the foundational real-time engine complete and the presentation unification currently underway.

---

*For questions or to discuss requirements in detail, contact: bilal@tabbio.com*
