---
summary: Playwright end-to-end suite — services it boots, environment overrides, the seeded host, and how to run it.
status: active
last_updated: 2026-10-19
---

# End-to-End Tests (Playwright)

```bash
cd frontend
bun run test:e2e                     # boots backend + next dev, runs e2e/**
bun run test:e2e -- --headed         # watch it
bun x playwright show-trace test-results/<test>/trace.zip   # after a failure
```

Unit tests are separate: `bun run test` (`bun test tests/unit`, no services).

## What it boots

`playwright.config.ts` starts two `webServer`s (reused when already running outside CI):

| Service | Command | Default |
| --- | --- | --- |
| Backend | `bun scripts/migrate.ts && bun src/app.ts` in `../backend` | `http://localhost:5103`, ready at `/ready` |
| Frontend | `bun x next dev --port 3103` | `http://localhost:3103` |

Against dedicated test containers — never the dev Mongo/Redis on 27017/6379:
Mongo `mongodb://127.0.0.1:27117/openpoll_w0c1?directConnection=true`, Redis
`redis://127.0.0.1:6390/3`. AI and mail keys are blank (mock drafts, logged mail).

## Overrides (`e2e/env.ts`)

`E2E_FRONTEND_PORT`, `E2E_BACKEND_PORT`, `E2E_FRONTEND_URL`, `E2E_API_URL`, `E2E_MONGO_URI`,
`E2E_REDIS_URL`, `E2E_HOST_EMAIL`, `E2E_HOST_PASSWORD`, `E2E_CHROMIUM_PATH`. The system Chromium at
`/usr/bin/chromium` is used when present (no browser download); otherwise Playwright's bundled
one (`bun x playwright install chromium`).

## Host account

Login refuses unverified accounts and dev has no inbox, so global setup
(`e2e/global-setup.ts`) runs `backend/scripts/seed-e2e-user.ts`: it creates or resets a verified
user straight in the test database and deletes the `rl:*` rate-limit keys. The `host` fixture
(`e2e/fixtures.ts`) logs in through the API, creates decks with the token, and opens pages with
the token seeded into the persisted auth store (`auth-storage`). `joinAsParticipant` opens a fresh
browser context per participant.

## Specs

Opening the host page no longer opens a lobby: every spec starts from the "Ready to present" screen
and clicks **Open lobby** (`openLobby` helper) or **Start presenting** itself. Participants join a
lobby with `joinAsParticipant` (waits for "You're in!") or a running session with `joinMidSession`.
`host.getSessions(id)` lists a deck's runs and `host.lookupCodeStatus(code)` is the public code
lookup's HTTP status (404 until a session was opened).

- `e2e/live-flow.spec.ts` — characterization of the live flow: the ready screen (nothing opened, code
  lookup 404), an explicitly opened lobby, Start with no audience required, two participants,
  select_answer, wordcloud and scales slides, the timer-driven reveal, a leaderboard slide, end
  screens ("Present again"). Asserts visible text and roles only, so markup refactors keep it
  green. Slides use 10 s timers; the run takes ~40 s.
- `e2e/live-session.spec.ts` — the session-aware host and phone behaviour (long timers, driven by
  hand so nothing races the auto-reveal): back/forward (buttons and arrow keys) with stored phase
  and results on revisit, a slide left unanswered coming back closed, and Reopen; an untimed slide
  open until **Close voting**, then reopened (also after a reveal); presenting twice (the second
  run starts fresh, the first stays on record with its counts, the first run's phone is offered
  the new session and rejoins with its nickname pre-filled); reloading the phone or the host
  console mid-question, after answering, after the reveal and on a content slide (per-session
  credentials in `localStorage`, `live-state` resync, the console resumes); a finished deck shows
  "Present again" instead of auto-opening a lobby.
- `e2e/content-slides.spec.ts` — content slides: a deck of all eight content types presented
  fullscreen **without a lobby or any participant** (F key, arrow-key and button navigation, each
  stage layout, end; the run is on record with 0 participants), and a mixed deck (heading → word
  cloud → select answer) clicked through with two participants (~30 s). Image and YouTube requests
  are answered with `page.route`, so the run needs no network.
- `e2e/select-answer.spec.ts` — a graded multi-select slide (checkboxes, exact-set scoring,
  shares of respondents, explanation after reveal) and an ungraded 0-point slide (no right/wrong)
  live; the builder editing and saving an ungraded multi-select slide (checked through
  `host.getDeck`). ~30 s.
- `e2e/sessions.spec.ts` — session history and reports (`features/sessions`): a deck is run through the
  real join/answer routes, then history, report, CSV download, the locked Excel dialog, a share link
  opened in a signed-out context, a participant's own results, deletion; Excel/PDF downloads on the Pro
  plan (the spec sets and restores the plan with `backend/scripts/set-plan.ts`); the library menu entry.
  ~25 s.
- `e2e/advanced-slides.spec.ts` — a deck of `guess_number`, `hundred_points`, `grid_2x2` and
  `pin_on_image` run live with two participants (typed, slider, tapped and arrow-key answers, the
  100-point overshoot guard, reveal of each: correct answer, ranks, markers, correct area and tally,
  scores), the builder editing and saving all four, and the picker adding an ungraded guess slide.
  The slide image is served by `page.route`. ~70 s.
- `e2e/qna-reactions.spec.ts` — Q&A with moderation (a participant asks, the host sees it pending
  and approves or rejects, another participant upvotes, the host puts a question on screen and
  takes it down, marks it answered), a reaction floating up the stage, and the builder's Audience
  tab plus adding a Q&A slide. The deck is created with `settings` through the API directly (the
  `host.createDeck` fixture sends title and slides only). ~20 s.

- `e2e/ai-deck.spec.ts` - AI whole-deck authoring in mock mode (the e2e backend has no AI key): the
  AI dialog's "Whole deck" tab, outline review and editing, the written deck with speaker notes,
  the "Generated with mock data (no AI key configured)" label in the dialog and the builder banner,
  the deck opening in the builder and keeping its notes on save; form validation; the quick-slides
  tab. ~10 s.

- `e2e/billing.spec.ts` — `/settings/billing` against the real API with billing off (disabled
  notice, plan, usage meters, no fake buttons; 503 from checkout and portal), then the enabled
  flows with `page.route` patching the real `/api/plans` and `/api/billing` responses (prices,
  yearly toggle, Team seats, checkout redirect to a stand-in Stripe page, the wait for the plan
  after `?checkout=success`), and the landing pricing from the API, with prices, and on the
  built-in fallback when the API is unreachable. Stripe is never called. It logs in once in
  `beforeAll` instead of through the `host` fixture: `/api/auth/login` allows 10 logins per 5
  minutes per IP, which the whole suite shares. ~20 s.

Run against your own database and ports when other suites share the machine, e.g.
`E2E_MONGO_URI=mongodb://127.0.0.1:27117/openpoll_mine?directConnection=true
E2E_REDIS_URL=redis://127.0.0.1:6390/11 E2E_BACKEND_PORT=5111 E2E_FRONTEND_PORT=3111 bun run test:e2e`.
