---
summary: Product-wide test plan before the release in 06-merge-and-deploy.md, covering every scenario, how each is covered, the results of the 2026-11-01 pass and the 2026-11-05 Firefox and WebKit pass.
status: active
last_updated: 2026-11-05
---

# Product-wide test plan

## Why this exists

The 2026-11-01 readiness review called the product "tested" because CI was green. A real click on
**End Session** in the Claude desktop browser pane did nothing:
- The button asked for confirmation with native `window.confirm()`.
- Embedded browsers suppress that dialog and answer "no".
- The Playwright host fixture auto-accepted every native dialog, so the suite could not see the bug.
- The manual walkthrough overrode `window.confirm`, so it missed it too.

Two rules follow:

1. **No native dialogs.** The UI confirms with the app's own `AlertDialog` (`ConfirmDialog`,
   `EndSessionDialog`). `e2e/fixtures.ts` → `dismissNativeDialogs(page)` dismisses any native dialog, the way
   an embedded browser does, so a flow that depends on one fails its spec.
2. **A test must exercise the real interaction.** Never stub `confirm`, `fetch` or timers in a manual
   pass or a spec to "get past" a step. If a step can't be done for real, record it as not covered.

## Layers

| Layer | Where | Runs |
| --- | --- | --- |
| Backend unit | `backend/tests/*.test.ts` | CI `Backend (typecheck + test)` |
| Backend integration (Mongo + Redis) | `backend/tests/integration`, `tests/spikes` | CI `Backend (integration)` |
| Load smoke | `backend/loadtest` | CI `Load test`, nightly |
| Frontend unit | `frontend/tests/unit` | CI `Frontend (… unit tests …)` |
| End-to-end (Playwright, Chromium) | `frontend/e2e/*.spec.ts` | CI `End-to-end (Playwright)` |
| Manual exploratory | browser pane, phone width, both themes | before each release |

**Local e2e.**
- Run from a separate git worktree on disk, so your own `next dev` keeps running.
- Never put the worktree under `/tmp`: it is a RAM-backed tmpfs and a run fills it (`-122 EDQUOT`).
- Use a fresh database per run, because monthly plan usage (imports, AI decks) carries over between runs:
  ```bash
  E2E_MONGO_URI="mongodb://127.0.0.1:27117/openpoll_e2e_$(date +%s)?directConnection=true" \
  E2E_REDIS_URL=redis://127.0.0.1:6390/13 bun run test:e2e
  ```

## Scenario matrix

[`scenario-inventory.md`](./scenario-inventory.md) holds 423 scenarios in 18 areas. Each row has an id, the
scenario, the expected result, its coverage (`e2e:` / `be:` / `unit:` / `NONE`) and a priority.

At the start of the pass:
- 148 scenarios had an e2e spec.
- 198 were covered only by backend or unit tests.
- 77 had no automated coverage: 13 P0, 31 P1, 33 P2.

The whole quick-poll product (`/create`, `/p/[id]`, `/analytics/[id]`) had no frontend test at all.

## Results of the 2026-11-01 pass

### Bugs found and fixed (committed on `feat/editor-v2`)

| # | Bug | Found by | Fix |
| --- | --- | --- | --- |
| 1 | **End Session** and **Close lobby** did nothing in embedded browsers (native `confirm()`) | owner, in the Claude app pane | `EndSessionDialog` in the host console |
| 2 | Remove custom domain, revoke SCIM token and delete SSO connection: same native `confirm()` | code scan | `ConfirmDialog` |
| 3 | E2E auto-accepted native dialogs, so 1–2 could never fail a spec | review | `dismissNativeDialogs()` in `e2e/fixtures.ts`; specs confirm in-app |
| 4 | Every signed-out page (landing, audience join `/live`) called `/auth/me` → `refresh-token` → `logout`. Those count against per-IP auth limits (60 and 30 per 5 min); on conference Wi-Fi or an office NAT the audience triggers 429s and signed-in hosts fail to refresh | manual pass, network log | `checkAuth` skips the network with no token and no `auth_session` cookie |
| 5 | A wrong password on login ran the token-refresh interceptor. In a fresh browser the user saw the refresh error, not "Invalid email or password". With another session's refresh cookie, the wrong-password attempt **signed that session in** | new `auth-flows` spec | No refresh for `/auth/*` except `/auth/me` (`isCredentialCall`) |
| 6 | A failed refresh cleared the store but left the user on a page full of load errors | inventory (AUTH-25) | Redirect to `/login` from app pages |
| 7 | `/presentation/create`, `/presentation/host/*`, `/presentations/*` were not protected by the proxy | handoff note, inventory | `/presentation` prefix in `isProtectedRoute` (`lib/routes.ts`) |
| 8 | Ended session with no answers said "No scores yet — waiting for the first answers." | manual pass | `final` leaderboard copy |
| 9 | Signup showed a disabled "Continue with SSO (coming soon)" while login offered working SSO | audit | Signup uses `SsoDiscovery` |
| 10 | `/test` mock pages reachable in production | audit | 404 in production builds |
| 11 | Library, settings, analytics, deck builder and session pages showed the landing page's tab title | manual pass | Page titles |
| 12 | Home's live card cut the deck title to "Q4 ..." at laptop widths | manual pass | Stacks until `xl`, two-line clamp |
| 13 | **Identified polls: one email could vote twice** by typing another name (the dedup key was `guest:<email>:<name>`) | `quick-poll` spec | Dedup on the normalized email; backend test added |
| 14 | Assessments (TRIAL): the same name loophole reset attempts and the "already passed" check | review of 13 | Attempt lock, count and passed check match every name under that email |
| 15 | **Edits to a saved deck were lost on reload.** The server copy overwrote the restored local draft, and autosave then saved the old version over it | `builder` spec | The draft carries `savedAt`; a draft newer than the deck's `updatedAt` wins |
| 16 | `/live`: "Enter the 6-digit code" could never show (Join disabled below 6 digits), so a short code did nothing | `participant-join` spec | Join enabled once a digit is typed |
| 17 | Phone tap targets: the word-chip remove button (~18 px) and the rating sliders (8 px) | `participant-mobile` spec | 44 px tall without changing the look |

### Coverage added

- `e2e/auth-flows.spec.ts`: AUTH-01, AUTH-05, AUTH-12, AUTH-14, AUTH-24, AUTH-25 and AUTH-28.
  It covers sign up, the unverified login refusal, verification and login; forgot password, reset, and
  old-versus-new password; silent refresh; a lost session going to login; log out; and signed-out route guards.
  `backend/scripts/e2e-issue-token.ts` stands in for the email link.
- `e2e/quick-poll.spec.ts`: an anonymous vote at `/p/[id]`, the live results, one vote per device, and the
  host's analytics count.
- `e2e/library.spec.ts`: search, type tabs, close a poll and delete a deck through in-app confirms.
- `tests/unit/proxy.auth.test.ts`: protected routes and refresh scope.
- `e2e/poll-builder.spec.ts`: POLL-01, POLL-02 and POLL-03. It builds a poll with the phone preview, saves a
  draft, reopens it from the library, and publishes an identified poll and a closing date.
- `e2e/quick-poll.spec.ts` (extended):
  - POLL-08/09: the guest gate, one vote per person across tabs and devices, and the same email under
    another name.
  - Multi-select answering and skipping an optional question.
  - POLL-12/16: closing from the library stops answers at once.
  - POLL-15: published results.
- `e2e/builder.spec.ts`:
  - BLD-39: Home → New deck → Build manually, three slide types, notes, then Present.
  - BLD-38: reload restores a new deck and edits to a saved deck; leaving keeps a backend draft.
  - BLD-07: validation blocks Present.
- `e2e/participant-join.spec.ts`: PART-01 (typing the code: bad format, unknown, valid), PART-05, PART-06,
  PART-09 and PART-30.
- `e2e/participant-mobile.spec.ts`: UX-02 at 375×812 with touch. It joins, answers multiple choice, word cloud
  and scales, and reaches the end screen; each screen is checked for overflow and 44 px targets.
- `backend/tests/responses.security.test.ts`: a guest is their email (another name, another letter case).

### Runs

| Run | Tree | Result |
| --- | --- | --- |
| Full e2e #1 | dialog fixes only, reused DB, tmpfs worktree | 49 passed, 2 failed: monthly import quota left over from earlier runs; `/tmp` full (`EDQUOT`). Both are environment problems |
| Full e2e #2 | dialog, auth-probe and guard fixes, fresh DB | 53 passed, 1 failed: bug 5, found by the new spec. "Logout failed 429" lines in the log dropped from dozens to 0 |
| New specs | all fixes above | 6 passed, 0 failed |
| Full e2e #4 | 24 spec files, fixes 1–17 | Stopped by a session restart after 48 tests: 47 passed, 1 failed. `imports.spec` caught a regression in fix 15: autosave wrote the blank placeholder before the saved deck loaded, so that "newer" empty draft won. Fixed: no autosave while the deck loads |
| Full e2e #5 | 24 spec files, all fixes | 77 passed, 1 failed. The tap-target test measured the word chip mid scale-in animation (42.98 of 44 px); the helper now waits for the size to settle. The anonymous two-tab test is an expected failure (open decision). No native dialog came up and there were 0 "Logout failed" lines |
| Phone spec re-run | after the helper fix | 2 passed |

### Owner decisions acted on (1 Nov 2026, second round)

| Decision | Outcome |
| --- | --- |
| Plan limits | Kept as they are. `backend/scripts/plan-impact.ts` reports on the rehearsal copy which polls and sessions they hit |
| Domain | `open-poll.anands.dev` (already live, same site as `openpoll-backend.anands.dev`): no cross-site cookie problem. Use it for `NEXT_PUBLIC_SITE_URL` and `FRONTEND_URL` |
| Abandoned sessions | **Built:** lobbies end after 6 h idle and presented sessions after 12 h idle (`SESSION_IDLE_*_HOURS`), through the host's own end path. `lastActivityAt` + migration `200`; audit `session.auto_ended` |
| New deck's first slide | **Built:** an unscored multiple-choice question; "Graded" makes it a quiz question |
| Anonymous two tabs | Kept by design; publish settings explain it and point to named polls. The spec asserts the decided behaviour |
| Launch scope | **Built:** duplicate decks and polls from the library and Home (`POST /api/presentations/:id/duplicate`, `POST /api/polls/:id/duplicate`); edit your name and change your password on `/settings/profile` (`PATCH /api/me`, `POST /api/me/password`, other sessions signed out, email sent). An edited name survives Google/OIDC sign-in. Removing a participant stays after launch |
| Release date | After the rehearsal |

### Still open

- **Library search:** clicking a card within 300 ms of typing can lose the navigation, because the delayed search
  update calls `replaceState` (`LibraryView.tsx`).
- **Analytics** offers "Publish results" while a poll is open, and it fails with a generic error.
- **Builder:** Present appears only after the first save, and questions in a quick poll cannot be reordered.
- **Host view after a backend restart (seen once, needs a repro test).** A session open across a restart
  kept the host's answered count at 0 and showed a final score of 0 while the phone showed 834. A reload
  corrected it, and a clean run was fine.
- **Password change:** other devices keep working until their access token expires (up to 15 minutes);
  MCP tokens are not revoked by it.
- **Still not built:** a kick-participant control; builder controls for the nickname mode, results on phones and
  audience language; speaker notes in the host console.
- **Not testable here:**
  - Google OAuth and real SSO identity providers: no keys.
  - Stripe checkout: no keys; billing has a disabled-mode spec.
  - Real PPTX through Gotenberg, Google Drive. (Gotenberg: see 2026-11-05 below.)
  - Browsers other than Chromium. (Done 2026-11-05, below.)

## Firefox and WebKit pass (2026-11-05)

The whole Playwright suite (80 tests) ran in Firefox and in WebKit, the engine of Safari and every iPhone
browser. How to run it: `frontend/docs/wiki/testing/e2e.md`, "Other browsers". WebKit ran through the
official Playwright image, because Arch lacks its libraries.

**Firefox: green.** The first run had 3 failures, none in the product:
- `auth-flows`: a `goto` raced the "Continue to login" link's own navigation and was aborted. The test now
  waits for the link to land.
- `duplicate`: the library search refetches after a debounce and re-rendered the cards under the menu
  click. The test now waits for the search response.
- `participant-mobile` UX-02: Playwright's Firefox has no touch emulation, so the tap-driven test skips
  itself there. WebKit runs it.

**WebKit: green after one product fix.**
- **Product bug, fixed:** after "Build manually" or "Generate with AI", the New deck dialog stayed
  over the builder, nearly invisible. Its exit animation never finished, and the dialog lives in the
  dashboard layout, which survives the navigation. Its box still caught clicks in the middle of the
  builder. Leaving by navigation now unmounts it at once (`CreatePresentationModal.tsx`); Close and
  Escape still animate.
- Against the dev server, specs that fill a form right after load lost the first field: the slow dev
  bundle hydrated after Playwright typed. Against a production build (`E2E_FRONTEND_MODE=start`) they pass,
  so this is not a Safari problem.
- Test fixes: downloads read through `saveAs` (a remote browser has no local path); the billing spec sets
  its session cookies on the context and carries the refresh cookie from its login; the paid-plan test
  switches the plan by time instead of by read count; the phone spec accepts touch support reported
  through `ontouchstart` (WebKit).
- A full WebKit run against the production build trips the auth rate limit (10 logins per 5 minutes per
  IP) near its end; the affected specs pass on their own. Chromium in CI is slower and does not hit it.

**Gotenberg, real container (2026-11-05).** A generated 3-slide PPTX with a chart and SmartArt converted
to a 3-page PDF in 0.7 s through `renderPptxToPdf` and `gotenberg/gotenberg:8`.

**Still open:** real iPhone and Android devices (emulation only so far), and a room of real phones.
