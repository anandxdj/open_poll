---
summary: Playwright end-to-end suite — services it boots, environment overrides, the seeded host, and how to run it.
status: active
last_updated: 2026-11-05
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
| Frontend | `bun x next dev --port 3103`, or `bun x next start --port 3103` with `E2E_FRONTEND_MODE=start` (serves an existing `next build`, built with the `NEXT_PUBLIC_*` the config passes) | `http://localhost:3103` |

**CI runs the production build** (`.github/workflows/ci.yml`: `next build`, then the suite with
`E2E_FRONTEND_MODE=start`). The dev server compiles every route on first visit and keeps it: the
suite's processes peaked at ~4.7 GB in dev mode against ~1.4 GB with `next start` (measured with
the whole suite under a no-swap memory cap: dev mode was OOM-killed at 4 GB, start mode passed).
On a small runner, next to the Mongo and Redis containers, that pressure made the kernel kill a
Chromium renderer: `Page crashed` in `presenter.spec.ts` (on main and on PRs, before and after
the embeds specs existed). To run as CI does: `next build` with `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_SOCKET_URL` set to the backend origin, then `CI=1 E2E_FRONTEND_MODE=start bun x playwright test`.

Against dedicated test containers — never the dev Mongo/Redis on 27017/6379:
Mongo `mongodb://127.0.0.1:27117/openpoll_w0c1?directConnection=true`, Redis
`redis://127.0.0.1:6390/3`. AI and mail keys are blank (mock drafts, logged mail).

## Overrides (`e2e/env.ts`)

`E2E_FRONTEND_PORT`, `E2E_BACKEND_PORT`, `E2E_FRONTEND_URL`, `E2E_API_URL`, `E2E_MONGO_URI`,
`E2E_REDIS_URL`, `E2E_HOST_EMAIL`, `E2E_HOST_PASSWORD`, `E2E_CHROMIUM_PATH`. The system Chromium at
`/usr/bin/chromium` is used when present (no browser download); otherwise Playwright's bundled
one (`bun x playwright install chromium`).

## Other browsers

`E2E_BROWSERS` picks the engines: unset runs Chromium only (CI), `all` or a comma list adds
`firefox` and `webkit` (`bun x playwright install firefox webkit`). WebKit needs Ubuntu libraries
(ICU 74, libxml2, flite) that other distributions lack; run it through the official image instead
and point `E2E_PW_SERVER` at it:

```bash
docker run -d --name openpoll-pw-server --network host --init --ipc=host \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  /bin/sh -c "cd /tmp && npx -y playwright@1.64.1 run-server --port 3333 --host 127.0.0.1"
E2E_BROWSERS=webkit E2E_PW_SERVER=ws://127.0.0.1:3333/ bun run test:e2e
```

Keep the image tag equal to `@playwright/test` in `package.json`. Playwright's Firefox has no touch
emulation, so the tap-driven phone spec (`participant-mobile` UX-02) skips itself there; WebKit
runs it. Results of the 2026-11-05 run are in `docs/planning/07-product-test-plan.md`.

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
- `e2e/offline-answers.spec.ts` — offline answers (W2-D phase 2): a phone picks an option, goes
  offline (`context.setOffline(true)`) and submits — "Saved — will sync", not counted — stays
  offline for more than 10 s, comes back and the answer is locked in and counted exactly once (host
  counter, reveal, the run's `answerCount`); a queued answer survives closing the tab while
  offline and is sent when the deck opens again in that browser (IndexedDB); a queued answer that
  arrives after the host closed voting is refused with "Voting closed before your answer arrived".
  ~35 s.
- `e2e/presenter.spec.ts` — W2-A presenter experience: the presenter view's notes, next slide,
  clock and responses, and the audience window opened from it following every move (two pages,
  BroadcastChannel; a reload of the audience window catches up); removing a participant through the
  app's dialog (the phone shows "You were removed from this session", also after a reload; the others
  answer on); pausing the timer (the phone and the stage show "Paused" with a frozen value, Submit
  waits), +30 s while paused, resume, skip and the auto-reveal; a second browser context as the phone
  remote (pairing link from the presenter view, a second phone refused, next from the lobby, pause /
  resume, reveal, unpair). ~35 s.
- `e2e/audience-pace.spec.ts` — W2-F audience pace with converted polls (created and converted through the
  API): the builder's Pace tab (attempts, results after each answer, optional nicknames; checked through
  `host.getDeck`), the host dashboard instead of the stage; a converted TRIAL with two participants at
  different speeds (Ada answers and passes while Bob has not started, Bob fails at 50 %, tries again and
  passes; right/wrong, explanation and results only once final; the dashboard's rows, stats and progress),
  **Close now** through the app's dialog; a converted poll with results after each answer, a guest
  ("Guest NNNN") and a named participant, results on the answered question only, progress per question,
  close (the unanswered question says "Closed before you answered") and **End session**. Participant
  contexts keep the Next.js dev-tools button, so Next / Back are matched exactly. ~25 s.
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

- Library card actions (`library.spec`, `folders.spec`): the search box is debounced, so specs wait for
  `q=` (and `type=`) to reach the URL before opening a card menu; otherwise the list reloads under the
  open menu.

- `e2e/duplicate.spec.ts` — LIB-19: "Duplicate" from the library card menu on a two-slide deck and
  a published poll; both copies appear as drafts, the deck copy opens from its toast in the builder
  with both slides and the notes, and the originals (and the deck's empty session list) are
  unchanged through the API. ~6 s.

- `e2e/folders.spec.ts` — W3-B2 library folders: New folder (the folder opens empty; a second folder of
  the same name is refused in the dialog), Move to folder… on a deck and a poll card, the "In folder"
  label, filtering by the folder chip and by Not in a folder (kept across a reload through `?folder=`),
  Rename folder and Delete folder from the folder menu (the app's AlertDialog; the items stay at the
  top level, checked through the API). ~10 s.

- `e2e/deck-themes.spec.ts` — light deck themes: a deck built in the light app is light in the builder
  (canvas and rail thumbnail, ink question), the host console (ready, lobby, running slide), the
  presenter view and the phone; the Theme tab's Dark switch turns the canvas, the next session's stage
  and the phone graphite while the builder stays light, and a live session cannot be restyled; a deck
  built in the dark app is dark and stays dark when the app goes light; a light deck run through a
  heading, a quiz reveal, a word cloud, a leaderboard and the end screen; a light audience-paced deck on
  the host dashboard, the presenter view's dashboard and the phone's own-pace screens; an API deck without a mode
  and a template used in the light app are light, the same template in the dark app dark. Colours are
  read with `getComputedStyle` (paper `rgb(246, 246, 243)`, graphite `rgb(20, 20, 19)`, dark phone
  `rgb(13, 13, 12)`); the app theme is set like the profile switch does (`localStorage.theme`).
  Screenshots: `test-results/deck-themes-*.png`. ~45 s.

- `e2e/templates.spec.ts` — W3-B2 templates: the four starter templates on `/templates`, Use template
  on Team retro opens the builder with its nine slides; Save as template… from a library card (hidden
  from the library), the template under "Saved in this workspace", Use template opens it with its two
  slides, Delete template through the app's dialog (the deck made from it stays). A template opened by
  direct link shows "This is a template" in the host console (no Open lobby / Start presenting) and in
  the builder (no editor); Use template from each opens a new deck. ~12 s.

- `e2e/coediting.spec.ts` — W3-B2 co-editing safety: two builders (two browser contexts) on one deck;
  the first saves, the second's save shows the conflict banner and the deck keeps the first save; Save
  draft while it is up sends nothing; Reload latest version loads the first save and a later save
  works. Second test: Save mine as a copy opens a new "(my version)" deck with the local edits and leaves
  the other save untouched. Third test: presence, the same deck open in two pages of the (one) e2e host
  shows "You have this deck open in another tab" in both, and closing one removes it from the other.
  Fourth test: a builder left open without edits (slide selected only) keeps no local draft, picks up a
  co-editor's save on reload with no banner, and leaving it sends no save (the revision is unchanged).
  ~14 s.

- `e2e/members.spec.ts` — teams and sharing: owner invites a second (seeded) account from
  `/settings/members`, the invite link is read from the form (no mail provider in e2e), the invitee
  signs in through `/login?next=…`, joins as editor, sees the deck and is refused member
  management; the owner demotes them, shares the deck through the ShareDialog and checks the
  audit log. Seeds the second user with `scripts/seed-e2e-user.ts` and upgrades the new workspace
  with `scripts/set-plan.ts` (a free team has one seat). ~30 s.

- `e2e/profile.spec.ts` — `/settings/profile` for a freshly seeded account: logs in through the UI,
  renames (empty name refused; the account menu, a reload and the Home greeting show the new name),
  changes the password (show/hide, mismatch and a wrong current password shown under their fields),
  logs out, then the old password fails and the new one signs in. ~15 s.

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

- `e2e/embeds.spec.ts` — W4-D embeds from another site: a tiny HTTP server on 127.0.0.1 (another origin
  than the app's `localhost`; a `page.route` page counts as public to Chromium, whose local-network
  protection would refuse to frame the local app at all) serves host pages that iframe the embeds. A
  participant joins and answers inside `/embed/live/<code>` (the iframe from oEmbed's `html`), the host
  console sees it, and the frame takes the heights the page posts; mid-session, the Embed dialog's
  switch still works and a new screen shows the already approved, highlighted Q&A question at once; the builder's Embed dialog turns
  embedding on and creates a screen link (real clicks), the stage embed follows lobby, joins, live
  counts, reveal and end, the results embed shows the shared run, and turning the link off (in-place
  confirmation, no `confirm()`) blanks the stage; `/live/<code>`, `/login` and the embed of a deck with
  embedding off refuse to be framed (`frame-ancestors` console error, nothing renders), and opened
  directly the latter says "Embedding is turned off"; Settings → Workspace → Embedding (an invalid
  site refused, another site listed → ours refused, ours listed → framed, removed → any site).
  Embedding is turned on through the API before the first page load: the proxy keeps policy answers
  for 10 s, so each check uses a target the proxy has not seen. ~35 s.

- `e2e/addins.spec.ts` — W4-D add-in panes as browser pages, with Office.js and the Teams library
  blocked (`page.route` abort, so no network and no host): the PowerPoint pane (Microsoft 365
  frame-ancestors, a foreign link refused, a pasted screen link shows the stage, follows the lobby,
  is remembered after a reload, "Change screen link"); the Teams configuration page (tab address),
  side panel (share button disabled outside a meeting, an attendee joins and answers there) and stage
  page (live counts); the Zoom page (OWASP headers, the stage, "Embedding is turned off" at once,
  without a reload, when the deck stops allowing it). ~15 s.

- `e2e/a11y-live.spec.ts`, `e2e/a11y-audience-pace.spec.ts`, `e2e/a11y-public.spec.ts` — W4-A axe scans
  (`@axe-core/playwright`, helper `e2e/axe.ts`: WCAG 2.0/2.1/2.2 A and AA plus best practices, after the
  page's animations settle). A serious or critical finding fails the test (`expect.soft`, so one run lists
  every surface); every finding of any impact goes to `test-results/axe/findings.jsonl`, one line per scan.
  Each runs in a light and a dark deck: the host console (ready, lobby, slide, reveal, content, leaderboard,
  End session dialog, end), the presenter view (ready, pairing, lobby, slide, reveal, end), the audience
  window, the phone remote, and the phones (join form, lobby, answering, locked in, right and wrong,
  look at the screen, leaderboard, end, the results page); every slide type family on the phone and the
  stage, open, answered and revealed (18 types); audience pace (dashboard not open / lobby / open / close
  dialog / closed / ended, the presenter view's dashboard, the room screen, the phone's waiting, question,
  answered, content, summary, result, review, closed); the landing, login, signup and join pages in the
  light and dark app on a phone and a desktop. Slide images and the YouTube player are answered by
  `page.route`. ~5 min in all.
- `e2e/a11y-keyboard.spec.ts` — W4-A by keyboard: a phone joins and answers with keys only (focus on each
  new screen's heading, the announcer's sentences, the named silent `role="timer"` and its "10 seconds
  left", shortcuts only inside the option list, focus onto "Answer locked in!" after submitting, ranking
  moves keeping focus), the host's leaderboard and End session dialogs (focus trapped, Escape, focus back)
  and the Q&A drawer, reduced motion (CSS animations take no time), 320 px phones and the remote, the host
  console and presenter view at 200 % zoom (640×360) without sideways scrolling, and phone controls of at
  least 44×44 px. ~45 s.

- `e2e/landing-auth.spec.ts` — the landing and sign-in surfaces on public pages (no host needed): no
  horizontal overflow on a phone, tablet and desktop (landing, login, signup, forgot/reset password,
  privacy, terms), one h1 and one h2 per landing section, the mobile menu (toggle state, section links,
  Escape returns focus, Log in and Sign up free), the desktop header and `/#faq` jump, the hero links,
  the skip link as first Tab stop, the FAQ accordion by keyboard, and the login and signup forms (labels,
  autocomplete, focus order, the password show/hide toggle, the password rule hint). ~50 s.

Run against your own database and ports when other suites share the machine, e.g.
`E2E_MONGO_URI=mongodb://127.0.0.1:27117/openpoll_mine?directConnection=true
E2E_REDIS_URL=redis://127.0.0.1:6390/11 E2E_BACKEND_PORT=5111 E2E_FRONTEND_PORT=3111 bun run test:e2e`.
