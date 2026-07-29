# Planning — Mentimeter-Competitive Roadmap

> Created 2026-06-10. Output of a brainstorming/planning session.
> Audience target: **conferences & presenters**. Ambition: **serious SaaS**.

This folder holds the forward-looking product + security plans. It is intentionally
separate from the domain wikis (`backend/docs/wiki/`, `frontend/docs/wiki/`), which
document what *is* built. These docs describe where we are *going* and why.

## The documents

| Doc | What it answers |
| --- | --- |
| [`00-product-vision.md`](./00-product-vision.md) | Who we serve, how we win, the strategic reframe, the SaaS shape, success metrics. Read first. |
| [`01-competitive-roadmap.md`](./01-competitive-roadmap.md) | Mentimeter feature-gap analysis + a phased epic roadmap through GA. |
| [`02-security-hardening.md`](./02-security-hardening.md) | Verified vulnerabilities, severity, and a prioritized remediation plan. P0 items gate any public launch. |
| [`03-mcp-entity-gap.md`](./03-mcp-entity-gap.md) | Why asking an AI agent to create an assessment (`pollType: 'TRIAL'`) creates a plain poll. MCP strips `pollType` and the correct-answer fields. Fix plan. |

## The one idea to internalize

We are not building "a poll tool plus a quiz tool." We are building an **interactive
presentation platform**: a deck where some slides are content and some are interactive,
driven live by a presenter. The current `polls` and `quizzes` modules are the two halves
of that engine that have not been joined yet. Everything in the roadmap hangs off that
unification.

## Relationship to existing plans

- `backend/docs/wiki/quiz-roadmap.md` — the live-quiz phase plan (Phases 1–8). Still valid;
  these docs sit *above* it and re-frame Phases 4–8 as part of the unified presentation product.
- `frontend/docs/wiki/features/feature-tracker.md` — shipped/in-progress UI features.

## How to use this set

1. Align on `00-product-vision.md` (positioning + the reframe). Everything else inherits it.
2. Treat `02-security-hardening.md` **P0** as a gate: do not onboard real, untrusted audiences
   until P0 is closed. Result integrity is the entire value proposition of a polling product.
3. Pull epics from `01-competitive-roadmap.md` into `/ce-plan` one at a time when ready to build.
