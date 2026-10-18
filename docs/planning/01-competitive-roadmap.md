---
summary: Mentimeter feature-gap analysis and a phased epic roadmap for the conference/presenter SaaS pivot.
status: draft
last_updated: 2026-06-10
---

# Competitive Roadmap — vs. Mentimeter / Slido

Read [`00-product-vision.md`](./00-product-vision.md) first. This doc is the *what*; the vision
is the *why*. Phases here are **product epics**, higher-altitude than
`backend/docs/wiki/quiz-roadmap.md` (which they absorb and re-frame).

## Legend

- ✅ Have it · 🟡 Partial · ❌ Missing
- Priority: **P0** launch-gating · **P1** core parity · **P2** differentiation/SaaS · **P3** later

---

## 1. Feature-gap analysis

### A. Content & deck model — *the central gap*

| Capability | State | Notes |
| --- | --- | --- |
| Unified **Presentation** (mixed content + interactive slides) | 🟡 | `presentations` module is live and replaced `quizzes` (interactive + leaderboard slides only). Still two silos (`polls`, `presentations`) and no content slides. The #1 gap. |
| Content slide types (heading, paragraph, bullets, image, big number, quote, video) | ❌ | Needed so a whole talk lives in the tool. |
| Presenter-paced flow | ✅ | Quiz state machine already does this. |
| Audience-paced / self-paced flow | 🟡 | Async poll flow exists but disconnected from decks. |
| Slide reorder / duplicate / preview rail | 🟡 | Planned (quiz-roadmap Phase 5); not unified. |

### B. Interactive slide types

| Type | State |
| --- | --- |
| Multiple choice / select | ✅ |
| Word cloud | ✅ |
| Open ended / text wall | ✅ |
| Scales (Likert) | ✅ |
| Ranking | ✅ |
| Type-answer + scored quiz | ✅ |
| Guess-the-number, 100-points, 2x2 grid, pin-on-image | ❌ | quiz-roadmap Phase 4. |
| Q&A board (ask + upvote + moderate) | ❌ | **Flagship conference feature.** quiz-roadmap Phase 8. High value here. |
| Live reactions (emoji) | ❌ | quiz-roadmap Phase 8. |

### C. Presenter experience

| Capability | State | Notes |
| --- | --- | --- |
| Presenter view (notes, next-slide preview, timer) | ❌ | A differentiation wedge for us. |
| Phone-as-remote | ❌ | |
| Fullscreen, countdown, sound cues | 🟡 | quiz-roadmap Phase 5. |
| Pause/extend timer, skip, kick participant | ❌ | quiz-roadmap Phase 5. |
| Offline resilience / reconnect without data loss | 🟡 | Redis-first helps; no client-side buffering. **Wedge.** |

### D. Content authoring & import

| Capability | State | Notes |
| --- | --- | --- |
| AI generation (topic → quiz) | ✅ | `POST /api/ai/generate-quiz`. Strength. |
| AI **whole-deck** authoring (abstract → mixed content+interactive) | ❌ | Natural extension; differentiation. |
| Import from PowerPoint / PDF / Google Slides | ❌ | Big adoption lever for presenters. |
| Import questions from Excel/CSV | ❌ | quiz-roadmap Phase 8 (slide import). |
| Themes / branding / brand kit | ❌ | Single Amber design system today; SaaS gating opportunity. |

### E. Results, sharing & history

| Capability | State | Notes |
| --- | --- | --- |
| Live results on big screen | ✅ | Core reveal renderers exist. |
| Session history (same deck, many runs) | ❌ | quiz-roadmap Phase 7. `open-lobby` currently wipes prior run. |
| Export (CSV/PDF/Excel) | 🟡 | Poll CSV exists; no quiz/session export, no PDF. |
| Shareable read-only results link / embed | ❌ | quiz-roadmap Phase 7. |
| Participant take-home summary | ❌ | quiz-roadmap Phase 7. |
| Cross-presentation analytics dashboard | ❌ | SaaS need. |

### F. Platform / SaaS

| Capability | State | Notes |
| --- | --- | --- |
| Workspaces / teams (tenancy) | ❌ | Everything keyed on a single `creatorId`. |
| Roles & permissions | 🟡 | `user`/`admin` enum only; no per-resource roles. |
| Plans, billing, feature gating | ❌ | |
| SSO (SAML/OIDC), SCIM | 🟡 | Google OAuth only. |
| Templates, folders, co-editing | ❌ | |
| Audit log, data retention, GDPR export/delete | ❌ | Compliance + trust feature. |
| Custom domain / white-label | ❌ | P3. |
| Integrations (Zoom/Teams/PowerPoint add-in) | ❌ | P3, high effort. |

### G. Scale, reliability, accessibility, i18n

| Capability | State | Notes |
| --- | --- | --- |
| Multi-instance socket rooms (redis-adapter) | 🟡 | quiz-roadmap Phase 6. Pub/sub fan-out only today. |
| Socket-based answer submission + ack | ❌ | quiz-roadmap Phase 6. |
| Load tested (2k answers/sec target) | ❌ | quiz-roadmap Phase 6. |
| Metrics / observability (`/metrics`, latency histograms) | ❌ | quiz-roadmap Phase 6. |
| Accessibility (a11y: keyboard, screen reader, contrast) | ❌ | Table-stakes for enterprise buyers. |
| i18n of participant strings | ❌ | quiz-roadmap Phase 8. Global conferences. |

---

## 2. Phased epic roadmap

Each epic is a `/ce-plan`-sized chunk. Order matters: later epics assume earlier ones.
Security work runs **in parallel and gates launch** — see [`02-security-hardening.md`](./02-security-hardening.md).

### Epic 0 — Security P0 (gate) · **P0**
Close the launch-gating vulnerabilities before any untrusted audience. Detail in the security doc.
Non-negotiable: vote-integrity, identity, auth rate-limiting. *Do this first.*

### Epic 1 — The unification: `Presentation` entity · **P0**
The spine. Introduce a `Presentation` = ordered slides, each `kind: content | interactive`,
with a `pace` setting. Migrate `quizzes` into it first (smaller blast radius, shares the live
engine), then `polls` as the audience-paced mode. Model the **workspace** foreign key now even if
the UI exposes one default workspace — retrofitting tenancy later is expensive.
- **Acceptance:** a single deck mixes ≥1 content slide and ≥2 interactive types; presenter clicks
  through it live; existing quizzes/polls keep working via migration or compatibility read.

### Epic 2 — Content slide types · **P1**
Heading, paragraph/bullets, image, big number, quote, video embed, instructions. Pure display.
Unlocks "the whole talk lives here."
- **Acceptance:** a presenter can build a content-only deck and present it fullscreen.

### Epic 3 — Presenter experience · **P1** *(differentiation)*
Presenter view (speaker notes, next-slide preview, timer, live response count), phone-as-remote,
fullscreen polish, pause/extend/skip/kick (quiz-roadmap Phase 5).
- **Acceptance:** a full session is runnable from the presenter view without leaving fullscreen.

### Epic 4 — Q&A + reactions · **P1** *(flagship for conferences)*
Audience Q&A board (submit, upvote, presenter moderation queue, mark answered) + rate-limited live
emoji reactions (ephemeral, Redis pub/sub only). High value for this segment specifically.
- **Acceptance:** audience submits + upvotes questions; presenter moderates; reactions burst live.

### Epic 5 — Sessions, history & export · **P1**
Persist each run as a `Session` (stop wiping prior runs); per-session reports; CSV/PDF export;
shareable read-only results link; participant take-home page (quiz-roadmap Phase 7).
- **Acceptance:** presenting a deck twice preserves both sessions; exports reconcile with Redis/Mongo.

### Epic 6 — Themes & branding · **P2**
Theme presets, custom colors/fonts/logo/background, brand kit. Natural plan-gated SaaS feature.
- **Acceptance:** a presentation renders in a non-default theme on host + participant + reveal.

### Epic 7 — Import & AI deck authoring · **P2** *(differentiation)*
Import PowerPoint/PDF/Google Slides + Excel/CSV question import; extend AI from quizzes to
**whole mixed decks** from a talk abstract.
- **Acceptance:** an uploaded PPTX becomes an editable deck; AI produces a mixed content+interactive deck.

### Epic 8 — Scale & reliability hardening · **P1** (parallel with 3–5)
Socket-based answer submit + ack, `@socket.io/redis-adapter`, coalesced broadcasts, Lua-atomic
answer pipeline, load test + CI smoke, `/metrics` (quiz-roadmap Phase 6). Plus **offline
resilience** on the client (buffer answers, reconnect, "will sync" state) — our wedge.
- **Acceptance:** 2 instances run one session correctly; 2k answers/sec; client survives a 10s
  network drop without losing the participant's answer.

### Epic 9 — SaaS platform: workspaces, roles, billing, SSO · **P2**
Workspaces/teams, per-resource roles, plans + billing + feature gates, SAML/OIDC SSO + SCIM,
templates, folders, co-editing, audit log.
- **Acceptance:** two workspaces are fully isolated; a plan limit (e.g., audience cap) is enforced;
  an enterprise user logs in via SSO.

### Epic 10 — Accessibility, i18n, compliance · **P2**
a11y pass (keyboard, screen reader, contrast), participant-string i18n, GDPR data export/delete +
retention windows, documented anonymity guarantees.
- **Acceptance:** WCAG AA on participant + presenter core flows; participant UI localizes; a user
  can export and delete their data.

### Epic 11 — Integrations & white-label · **P3**
Zoom/Teams/PowerPoint add-ins, live embed, custom domains.

---

## 3. Suggested sequencing (the critical path)

```
Epic 0 (Security P0) ──► Epic 1 (Unification) ──► Epic 2 (Content slides) ──► Epic 3 (Presenter view)
        │                                                                           │
        └────────────── Epic 8 (Scale/reliability) runs in parallel ───────────────┘
                                                                                    │
                                  Epic 4 (Q&A) ──► Epic 5 (Sessions/export) ──► GA-ready core
                                                                                    │
                          then monetize: Epic 6 (Themes) ► Epic 9 (SaaS) ► Epic 7 (Import/AI) ► 10 ► 11
```

**The minimum lovable conference product** = Epics 0 + 1 + 2 + 3 + 4 + 5 + 8.
SaaS/billing (Epic 9) should follow validation with real design-partner presenters, not precede it.
