# Open Poll: end-to-end scenario inventory

Branch `feat/editor-v2` at `0023e44`, read on 2026-11-01. The working tree has uncommitted changes to the host End Session confirm, domain remove, SCIM revoke and several e2e specs. Where it matters, both states are noted (see DLG).

## How to read this

- **Coverage** lists every automated test that runs the scenario, fully or partly ("partial" says which part).
  - `e2e:` is a Playwright spec in `frontend/e2e/`.
  - `be:` is a backend test in `backend/tests/`.
  - `unit:` is a frontend unit test in `frontend/tests/unit/`.
  - `NONE` means no automated coverage at all.
- **Pri** is the priority of adding an **end-to-end** test.
  - It is set on every row that no e2e spec covers, including rows that backend or unit tests cover. It is `—` when an e2e spec covers the row.
  - On a `NONE` row it is the requested priority: P0 is the core funnel or data integrity, P1 is important, P2 is nice to have.
- How the e2e suite runs, which limits what it covers:
  - **Single Desktop Chrome project.** No phone viewport, and no dark mode.
  - **No real login form for the host.** The host token is seeded into `localStorage` and the `auth_session` cookie. Only `members.spec.ts` and `privacy.spec.ts` submit the login form.
  - **Optional integrations are off.** `JWT_ACCESS_EXPIRES_IN=2h` and every optional integration is blank: no storage, mail, Stripe, Google, OIDC or LLM.

## Summary

There are 423 scenarios:
- **148** are covered by at least one e2e spec.
- **198** are covered only by backend or unit tests (no e2e spec).
- **77** have no automated coverage (`NONE`): 13 are P0, 31 are P1 and 33 are P2.

The "Unit or backend only" columns give the e2e priority of the rows that have backend or unit tests but no e2e spec.

| Area | Scenarios | e2e | Unit or backend only | NONE | NONE P0 | NONE P1 | NONE P2 | Unit or backend only, P0 | Unit or backend only, P1 | Unit or backend only, P2 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1. Public and SEO (PUB) | 21 | 9 | 5 | 7 | 0 | 1 | 6 | 0 | 0 | 5 |
| 2. Auth (AUTH) | 39 | 8 | 20 | 11 | 6 | 5 | 0 | 1 | 9 | 10 |
| 3. Home (HOME) | 12 | 2 | 4 | 6 | 0 | 4 | 2 | 0 | 1 | 3 |
| 4. Library (LIB) | 24 | 5 | 13 | 6 | 0 | 3 | 3 | 2 | 5 | 6 |
| 5. Deck builder (BLD) | 44 | 16 | 23 | 5 | 2 | 2 | 1 | 0 | 13 | 10 |
| 6. Host console (HOST) | 34 | 22 | 5 | 7 | 0 | 2 | 5 | 1 | 2 | 2 |
| 7. Participant (PART) | 43 | 23 | 17 | 3 | 1 | 1 | 1 | 1 | 10 | 6 |
| 8. Q&A and reactions (QNA) | 18 | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 1 | 8 |
| 9. Sessions (SES) | 22 | 13 | 8 | 1 | 0 | 0 | 1 | 0 | 3 | 5 |
| 10. Quick polls (POLL) | 23 | 0 | 16 | 7 | 3 | 3 | 1 | 5 | 7 | 4 |
| 11. Analytics overview (ANL) | 11 | 3 | 6 | 2 | 0 | 0 | 2 | 0 | 0 | 6 |
| 12. Settings (SET) | 44 | 14 | 25 | 5 | 0 | 2 | 3 | 0 | 11 | 14 |
| 13. Imports (IMP) | 17 | 6 | 11 | 0 | 0 | 0 | 0 | 0 | 4 | 7 |
| 14. Role-based access (RBAC) | 17 | 4 | 11 | 2 | 0 | 2 | 0 | 1 | 4 | 6 |
| 15. Plan limits (PLAN) | 14 | 3 | 11 | 0 | 0 | 0 | 0 | 0 | 5 | 6 |
| 16. Errors and edge states (ERR) | 19 | 3 | 11 | 5 | 0 | 3 | 2 | 0 | 3 | 8 |
| 17. Responsive, theme, a11y (UX) | 15 | 5 | 3 | 7 | 1 | 2 | 4 | 0 | 0 | 3 |
| 18. Native dialogs (DLG) | 6 | 3 | 0 | 3 | 0 | 1 | 2 | 0 | 0 | 0 |
| **Total** | **423** | **148** | **198** | **77** | **13** | **31** | **33** | **11** | **78** | **109** |

**Most important P0 scenarios with no e2e test.** 12 have no automated test at all (NONE); the other 3 are tested only in backend or unit code.
1. POLL-03: publish a quick poll from `/create`. The whole `/create`, `/p/[id]` and `/analytics/[id]` product has no frontend test. **NONE**
2. POLL-07: vote on `/p/[id]`. Backend only.
3. PART-01: join from the `/live` code form, the entry point for anyone without a QR code. **NONE**
4. UX-02: the participant flow at phone size. The suite runs only Desktop Chrome. **NONE**
5. AUTH-05: open the email verification link, after AUTH-01 sign-up, which is tested in backend service code only. **NONE**
6. AUTH-28: signed out, opening protected routes redirects to `/login`. **NONE**
7. AUTH-24: access token expiry triggers a silent refresh and a retry. The e2e access token lasts 2 h, so this never runs. **NONE**
8. AUTH-25: a failed refresh signs the user out but does not redirect. This is a likely defect. **NONE**
9. AUTH-14: reset the password with a valid token. **NONE**
10. AUTH-12: log out. **NONE**
11. BLD-39: "Present" from the builder saves the deck and opens the host console. **NONE**
12. BLD-38: the builder's local draft autosaves and restores after a reload, so no edits are lost. **NONE**
13. POLL-02: save a poll draft and reopen it from the library. **NONE**
14. PART-34 and HOST-27: phone and host recover from a network drop (reconnect, answer retry with the same id, resync). Unit only.
15. POLL-09: a repeat or concurrent vote from the same ballot counts once. Backend only.

Other P0 rows tested only in backend or unit code:
- AUTH-01: sign up.
- POLL-08: identified poll gate.
- POLL-12: vote on a closed or expired poll.
- POLL-16: close a poll.
- LIB-11: delete a deck.
- LIB-15: close a poll from the library.
- RBAC-05: presenter role in the UI.

The one remaining NONE P0 is POLL-01, the poll builder itself.

## Inventories the matrix is built from

**Frontend routes (`frontend/app`)**
- Public:
  - `/`, `/privacy`, `/terms`, `/llms.txt`, robots, sitemap, OG and Twitter images
  - `/live`, `/live/[code]`, `/live/[code]/summary`
  - `/p/[id]`, `/r/[token]`, `/invites/[token]`, `/auth/complete`, `/api/auth/callback/id`
  - `/test`, `/test/card`, `/test/create` (mock pages)
- `(auth)`: `/login`, `/signup`, `/forgot-password`, `/reset-password/[token]`, `/verify-email/[token]`.
- `(dashboard)`:
  - `/home`, `/polls` (library), `/presentations` (redirect), `/create` (poll builder), `/presentation/create` (deck builder)
  - `/presentations/[id]/sessions[/sessionId]`, `/analytics`, `/analytics/[id]`
  - `/settings/{profile,mcp,privacy,workspace,members,brand,billing,sso,scim,domains,audit}`
- Outside the dashboard group: `/presentation/host/[id]`.
- Redirects in `next.config.ts`: `/quizzes`, `/quiz/create`, `/quiz/host/:id`, `/quiz/join`, `/quiz/play/:code`.
- The proxy protects only `/home`, `/polls`, `/create`, `/settings` and `/analytics`.

**Slide types (20).** They match between `backend/src/modules/presentations/slides/types` and `frontend/features/presentations/slides/types`.
- Interactive and quiz: `select_answer` (single, multi, graded or ungraded), `type_answer`, `wordcloud`, `open_ended`, `scales`, `ranking`.
- System: `leaderboard`.
- Advanced: `guess_number`, `hundred_points`, `grid_2x2`, `pin_on_image`.
- Board: `qna`.
- Content: `heading`, `paragraph`, `bullets`, `image`, `big_number`, `quote`, `video`, `instructions`.

**Socket events**
- Client to server: `live:join`, `live:leave`, `live:resync`, `answer:submit`, `reaction:send`, `poll:join`, `poll:leave`, and the legacy `quiz:join` and `quiz:leave`.
- Server to client:
  - Session: `session:lobby`, `slide:shown`, `question:started`, `slide:closed`, `question:revealed`, `leaderboard:shown`, `session:ended`
  - People and answers: `participant:joined`, `answer:received` (host only)
  - Q&A: `qna:question`, `qna:updated`, `qna:votes`, `qna:highlight`
  - Other: `reaction:burst` (host only), `analytics:update` (poll room), and the legacy copies `lobby:opened` and `quiz:ended`

**Settings sections (`sections.ts`)**

| Section | Gate |
|---|---|
| profile, mcp, privacy, workspace | none |
| members | team workspace only |
| brand | `brand_kits` plan feature, admin role |
| billing | owner role |
| sso | `samlSso` capability, team only, `sso` feature, admin |
| scim | `scim` capability, team only, `scim` feature, admin |
| domains | `customDomains` capability, `custom_domains` feature, admin |
| audit | `workspace:manage` (admin) |

**Roles (`roles.ts`)**

| Role | Can do |
|---|---|
| owner | Everything |
| admin | Everything except billing |
| editor | Every deck and session action; no workspace administration |
| presenter | Read and host decks, export session results |
| viewer | Read decks and session results |

Per-resource shares can grant editor, presenter or viewer, but only for shareable actions.

**Plans (`plans.ts`)**

| Plan | audienceCap | seats | AI decks per month | imports per month | Features |
|---|---|---|---|---|---|
| free | 100 | 1 | 5 | 5 | CSV export only |
| pro | 1,000 | 1 | 50 | 50 | XLSX and PDF export, brand kits |
| team | 2,000 | 5 (or the purchased number) | 200 | 200 | same as pro |
| enterprise | 10,000 | unlimited | unlimited | unlimited | adds SSO, SCIM, custom domains, white-label |

**Product gaps found while building the inventory.** These are scenarios the brief expects but the code does not support.
- **No way to remove a participant.** There is no host route or UI to kick someone. The server and the phone already handle `PARTICIPANT_KICKED`.
- **No duplicate in the library.** Decks and polls cannot be duplicated from the library; only a slide can be duplicated, inside the builder.
- **Unused deck settings.** `nickname` (optional or off), `showResultsOnDevices` and `audienceLocale` are stored on the deck, but the builder has no control for them and the phone ignores them.
- **No self-paced runtime.** Converted polls become "Self-paced deck"s (`pace: audience`), but no audience-paced runtime exists in the UI.
- **No speaker notes on the host console.** Speaker notes appear only in the builder.
- **Builder, host console and session pages are not proxy-protected.** `/presentation/*` and `/presentations/*` are missing from the proxy's protected prefixes. A signed-out visitor gets the page shell and failing API calls, and the app never redirects to login.
- **A failed refresh signs out silently.** When the token refresh fails, `logout()` clears the store but nothing redirects to `/login`, and parallel 401s are not coalesced into one refresh.
- **Leftover mock pages.** `/test`, `/test/card` and `/test/create` are mock pages reachable in production; robots only disallows them.
- **MCP tokens revoke without asking.** Revoking an MCP token takes effect at once, with no confirmation.

---

## 1. Public and SEO pages (PUB)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| PUB-01 | Landing renders at phone, tablet and desktop widths | One h1, a heading in every section, no horizontal scroll | e2e:landing-auth.spec.ts | — |
| PUB-02 | Desktop header: section anchors, Log in, Sign up free | Anchors scroll to their section; links go to `/login` and `/signup` | e2e:landing-auth.spec.ts | — |
| PUB-03 | Mobile menu opens, lists sections, Escape closes, reaches login and signup | `aria-expanded` toggles, focus returns to the toggle, links navigate | e2e:landing-auth.spec.ts | — |
| PUB-04 | Hero CTAs "Start for free" and "Join a session" | Go to `/signup` and `/live` | e2e:landing-auth.spec.ts (href only) | — |
| PUB-05 | FAQ accordion from the keyboard | One answer open at a time | e2e:landing-auth.spec.ts | — |
| PUB-06 | Question-types tablist switches the stage scene (click and arrow keys) | Selected tab and scene change; ARIA tabs pattern | NONE | P2 |
| PUB-07 | Pricing lists plans from `/api/plans`, with the yearly toggle and changed limits | Prices and limits match the API | e2e:billing.spec.ts | — |
| PUB-08 | Pricing when the API is unreachable | Falls back to the built-in catalogue | e2e:billing.spec.ts | — |
| PUB-09 | Pricing CTAs lead to signup, or to billing when signed in | Correct destination for each plan | NONE | P2 |
| PUB-10 | `/privacy` and `/terms` | Site header and footer kept, h1 present | e2e:landing-auth.spec.ts | — |
| PUB-11 | `robots.txt` | App paths and AI crawlers disallowed, public pages allowed, sitemap linked | unit:seo.test.ts | P2 |
| PUB-12 | `sitemap.xml` | Every public page once, absolute URLs | unit:seo.test.ts | P2 |
| PUB-13 | Canonical URL, OG title and JSON-LD on public pages | Correct tags; `<` escaped in JSON-LD | unit:seo.test.ts | P2 |
| PUB-14 | `/llms.txt` | Markdown brief with public pages and the FAQ | unit:seo.test.ts (builder only) | P2 |
| PUB-15 | `opengraph-image` and `twitter-image` routes | Render an image without error | NONE | P2 |
| PUB-16 | `noindex` on the signed-in app, `/r/[token]` and `/invites/[token]` | robots meta `noindex`, no referrer | unit:seo.test.ts; e2e:sessions.spec.ts (`/r` only) | — |
| PUB-17 | Legacy URLs `/quizzes`, `/quiz/create`, `/quiz/host/:id`, `/quiz/join`, `/quiz/play/:code`, `/presentations` | 308 to their new paths with the query kept | NONE | P2 |
| PUB-18 | `/test`, `/test/card` and `/test/create` in production | Expected 404 or removed; today they render mock data | NONE | P2 |
| PUB-19 | Signed-in user opens `/login` or `/signup` | Redirected to `/home` | NONE | P1 |
| PUB-20 | Custom domain host: `/` serves the branded join page, other paths go to the main site, unknown hosts get a 307 | Matches `customDomainAction` | unit:domains.test.ts; be:integration/domains.test.ts | P2 |
| PUB-21 | White-label workspace domain | "Made with Open Poll" footer hidden | NONE | P2 |

## 2. Auth (AUTH)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| AUTH-01 | Sign up with name, email and a valid password | "Check your email" state; verification mail queued; no session yet | be:auth.accounts.test.ts (service) | P0 |
| AUTH-02 | Sign up with an empty field or a weak password (fewer than 8 characters, no uppercase or digit) | Inline hint; toast; nothing created | e2e:landing-auth.spec.ts (labels and hint only) | P1 |
| AUTH-03 | Sign up with an email that already exists | Same response as a new email; the existing owner gets mail | be:auth.accounts.test.ts | P2 |
| AUTH-04 | Resend verification from the sign-up success state | Uniform toast; rate limited | be:auth.accounts.test.ts (uniform response) | P1 |
| AUTH-05 | Open a valid `/verify-email/[token]` | Verified state; login now works | NONE | P0 |
| AUTH-06 | Verify with an invalid, expired or already used token | "Invalid or expired verification link" state | NONE | P1 |
| AUTH-07 | Log in with valid credentials | `auth_session` cookie set; lands on `/home` or `?next=` | e2e:members.spec.ts, e2e:privacy.spec.ts | — |
| AUTH-08 | Log in with a wrong password or an unknown email | Same error for both; no session | be:auth.accounts.test.ts | P1 |
| AUTH-09 | Log in to an unverified account | 403 "Please verify your email"; resend offered | NONE | P1 |
| AUTH-10 | Login form accessibility | Labelled fields, focus order, password show/hide with `aria-pressed` | e2e:landing-auth.spec.ts | — |
| AUTH-11 | Login rate limit (10 per 5 min per IP, 20 per 15 min per email) | 429 with a readable toast | be:rateLimit.middleware.test.ts (generic) | P2 |
| AUTH-12 | Log out from the sidebar menu | Refresh token revoked, cookie cleared, `/login`; Back cannot reach app data | NONE | P0 |
| AUTH-13 | Forgot password for a known and an unknown email | Same "Check your inbox" for both; mail only for the known one | be:auth.accounts.test.ts | P1 |
| AUTH-14 | Reset password with a valid token | Mismatch and short passwords refused on the client; success goes to `/login`; new password works, old fails | NONE | P0 |
| AUTH-15 | Reset password with an invalid or expired token | "Reset link invalid" state | NONE | P1 |
| AUTH-16 | Google sign-in, from the button through the callback | `/auth/complete` exchanges the code (`/auth/oauth/exchange`) and lands on `/home` | be:auth.oauth.test.ts (state), be:platform.identity.test.ts | P1 |
| AUTH-17 | Google errors (`google_failed`, `google_unavailable`, state mismatch, unverified Google email) | `/login?error=` shows the mapped message | be:auth.oauth.test.ts, be:platform.identity.test.ts | P2 |
| AUTH-18 | Google with the email of an existing local account | Linked to one account; an unverified pre-registered password is wiped | be:platform.identity.test.ts, be:auth.oauth.test.ts | P2 |
| AUTH-19 | "Continue with SSO" with a work email on a verified domain | Goes to the IdP with an email hint | e2e:sso.spec.ts, unit:sso.test.tsx | — |
| AUTH-20 | "Continue with SSO" with no workspace connection | Falls back to deployment-wide OIDC, or a clear message | be:auth.oauth.test.ts (discovery) | P2 |
| AUTH-21 | Password login on a domain that requires SSO | `SSO_REQUIRED`; the form switches to SSO | be:integration/sso-scim.test.ts | P1 |
| AUTH-22 | SAML ACS completes sign-in (JIT account, role from groups) | Session created; `/auth/complete` then `/home` | be:integration/sso-scim.test.ts | P1 |
| AUTH-23 | SSO error redirects (`?error=sso_*`, expired resume, replayed or tampered response) | Mapped message on `/login` | be:auth.oauth.test.ts, be:integration/sso-scim.test.ts | P2 |
| AUTH-24 | Access token expires during use | A 401 triggers a silent `/auth/refresh-token`; the original request is retried and succeeds | NONE | P0 |
| AUTH-25 | Refresh token expired or revoked (for example deleted elsewhere) | Store cleared **and** redirect to `/login` (today: no redirect) | NONE | P0 |
| AUTH-26 | Refresh and logout from a cross-site Origin | Refused (CSRF origin check) | be:auth.csrf.test.ts | P2 |
| AUTH-27 | Reload a signed-in page | Persisted auth rehydrates; `/auth/me` revalidates | e2e:members.spec.ts (implicit, seeded store) | — |
| AUTH-28 | Signed out, open `/home`, `/polls`, `/create`, `/settings/*` or `/analytics` | Redirected to `/login` | NONE | P0 |
| AUTH-29 | Signed out, open `/presentation/create`, `/presentation/host/:id` or `/presentations/:id/sessions` | Should redirect to `/login`; today these routes are unprotected | NONE | P1 |
| AUTH-30 | Invite link opened signed out, then "Sign in to accept", then Join | Masked preview, return to the invite, joins, lands on `/home` in the team workspace | e2e:members.spec.ts | — |
| AUTH-31 | Invite link reused | "This invitation can't be used" | e2e:members.spec.ts | — |
| AUTH-32 | Invitee without an account: sign up from the invite, verify, return and accept | Joins with the invited role | NONE | P1 |
| AUTH-33 | Invite opened while signed in as another email | `INVITE_EMAIL_MISMATCH` with "sign in with another account" | be:integration/members.http.test.ts | P1 |
| AUTH-34 | Expired, revoked or unknown invite token | Error state, no join | be:integration/members.http.test.ts | P1 |
| AUTH-35 | Invite accepted after the seats filled up | Refused; the invite stays pending | be:integration/members.http.test.ts | P2 |
| AUTH-36 | `?next=` open-redirect guard; remembered invite (24 h) after Google or SSO | Only `/invites/<token>` or `/settings/privacy` honoured | unit:workspaces.members.test.ts | P2 |
| AUTH-37 | Log in again during the deletion grace period | "Your account will not be deleted"; deletion cancelled | e2e:privacy.spec.ts | — |
| AUTH-38 | Log in to an account deactivated by SCIM or the organisation | 403 "Your organization turned this account off" | be:integration/sso-scim.test.ts (deactivate) | P2 |
| AUTH-39 | Old access token after the account was deleted | `/auth/me` returns 401 | e2e:privacy.spec.ts | — |

## 3. Home (HOME)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| HOME-01 | Land on `/home` after sign-in | Greeting by time of day and first name, date label | e2e:members.spec.ts (lands only); unit:home.test.ts | — |
| HOME-02 | "Live now" panel while a deck is in its lobby or presenting | Shows the deck, "Lobby open" or "Live now", spaced join code, link to the host console | NONE | P1 |
| HOME-03 | Start something: Blank deck | Builder opens on a new deck | NONE | P1 |
| HOME-04 | Start something: Quick poll | Create poll modal, then `/create` | NONE | P1 |
| HOME-05 | Start something: Generate with AI | Deck modal opens on the AI card | NONE | P2 |
| HOME-06 | Start something: Import | Imports dialog opens | NONE | P2 |
| HOME-07 | "Last N days" headline numbers and the 7/30/90 range switch | Refetches; link to `/analytics` | unit:analytics.overview.test.tsx | P2 |
| HOME-08 | Recent work: the 6 latest cards with library menus; delete or close from Home | List updates in place; library link when there are more | e2e:members.spec.ts (deck heading visible) | — |
| HOME-09 | Empty workspace | Empty state with create actions; no errors | NONE | P1 |
| HOME-10 | Switch workspace while on Home | Every section refetches for the new workspace | unit:workspaces.store.test.ts | P1 |
| HOME-11 | Recent sessions and top content links | Go to the report and to `/analytics/[id]` | unit:analytics.overview.test.tsx | P2 |
| HOME-12 | Sidebar active item for each route (Members wins over Settings) | Correct highlight | unit:home.test.ts | P2 |

## 4. Library (LIB)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| LIB-01 | `/polls` lists polls and decks newest first, with the stat strip (All items, Live now, …) | Correct cards and counts | be:integration/library.test.ts, unit:library.query.test.ts; e2e:sessions.spec.ts (page used) | — |
| LIB-02 | Type tabs and status filter (Drafts, Live, Ended) | URL query updates; a bookmarked URL restores the filters; counts ignore filters | be:integration/library.test.ts, unit:library.query.test.ts | P1 |
| LIB-03 | Search by title (case-insensitive, regex characters literal), then Clear search | Matching cards only | be:integration/library.test.ts, be:library.query.test.ts; e2e:sessions.spec.ts (`?q=` deep link) | — |
| LIB-04 | Infinite scroll or "Load more" across pages | No duplicates or gaps | be:integration/library.test.ts, unit:library.query.test.ts | P2 |
| LIB-05 | Filters with no results | Explanation for the active filters | unit:library.query.test.ts | P2 |
| LIB-06 | "New deck" and "New poll" header buttons | Deck builder, and the poll modal then `/create` | NONE | P1 |
| LIB-07 | Deck card Edit and Present or Resume | `/presentation/create?id=` and `/presentation/host/[id]` | unit:library.query.test.ts (links) | P1 |
| LIB-08 | Deck menu: Copy join link | Clipboard has `/live/<code>`; toast | NONE | P2 |
| LIB-09 | Deck menu: Session history | `/presentations/:id/sessions` | e2e:sessions.spec.ts | — |
| LIB-10 | Deck menu: Share with team… (team workspace, editor and above) | ShareDialog opens | e2e:members.spec.ts | — |
| LIB-11 | Delete a deck (in-page confirm) | Card removed, counts adjusted, shares and sessions cleaned up | unit:library.query.test.ts (counts); be:integration/members.http.test.ts (share cleanup) | P0 |
| LIB-12 | Delete a deck that is live (lobby or active) | Refused, or the session is ended cleanly; phones told | NONE | P1 |
| LIB-13 | Poll draft card: "Edit draft", Delete | `/create?draftId=` loads it; delete removes it | NONE | P1 |
| LIB-14 | Published poll card: Analytics, Share, Open voting page, Copy link | Correct URLs (`/analytics/[id]`, `/p/[id]`) | unit:library.query.test.ts (links) | P1 |
| LIB-15 | Close a poll from its card (confirm) | Status Closed, Live count down by one, `/p/[id]` shows closed | unit:library.query.test.ts (count); be:integration/polls.tenancy.test.ts | P0 |
| LIB-16 | Convert a poll to a presentation | New self-paced deck of `select_answer` slides opens in the builder; responses not copied; poll keeps working | be:integration/library.test.ts, be:library.convert.test.ts | P1 |
| LIB-17 | Convert again (force) versus a repeat convert ("Open converted deck") | Repeat returns the same deck; force makes a new one; races make exactly one | be:integration/library.test.ts | P2 |
| LIB-18 | Convert a poll a deck cannot represent | Refused, naming the question | be:library.convert.test.ts, be:integration/library.test.ts | P2 |
| LIB-19 | Duplicate a deck or poll from the library (or Home) | "Copy of <title>": a draft deck with every slide, notes and theme, or an unpublished poll; no sessions or responses copied; viewers and presenters refused | e2e:duplicate.spec.ts, int:duplicate.test.ts | — |
| LIB-20 | Badges and status pills (Assessment, Self-paced deck, From poll or quiz; Draft, Lobby open, Live, Ended) | Correct labels | unit:library.query.test.ts | P2 |
| LIB-21 | Library scoped to the selected workspace; switching changes the list | No cross-workspace items | be:integration/library.test.ts, be:integration/tenancy-isolation.test.ts | P1 |
| LIB-22 | `/presentations` | Redirects to `/polls?type=presentation` | NONE | P2 |
| LIB-23 | Migrated legacy quizzes | Listed, open, and host like decks; old ids and codes work | be:integration/legacyQuizzes.test.ts | P2 |
| LIB-24 | A deck with an open lobby | Counted and shown as live | be:integration/library.test.ts; e2e:sessions.spec.ts (history shows "Lobby open") | — |

## 5. Deck builder (BLD)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| BLD-01 | New deck: title, a slide, "Create deck" | Saved; returns to the library; deck stored with defaults | e2e:advanced-slides.spec.ts | — |
| BLD-02 | Edit an existing deck (`?id=`) and "Save changes" | Changes persisted | e2e:advanced-slides.spec.ts, e2e:select-answer.spec.ts | — |
| BLD-03 | "New slide" picker: Interactive, Quiz, Advanced and Content sections; never leaderboard | Picked type appended and selected | unit:builder.editor-registry.test.ts, unit:slides.advanced.test.tsx; e2e:advanced-slides.spec.ts, e2e:qna-reactions.spec.ts | — |
| BLD-04 | Rail: reorder (buttons and Alt+Arrow), duplicate, delete; the last slide cannot be deleted | Selection follows the slide; duplicate is a deep copy without an id | unit:builder.slide-rail.test.ts; e2e:advanced-slides.spec.ts (delete only) | P1 |
| BLD-05 | Rail keyboard selection (Arrow, Home, End) and live-region announcements | Focus and announcements correct | NONE | P2 |
| BLD-06 | `select_answer` editor: options, correct marks, Graded switch, Allow multiple, Explanation | Saves `config` and points as specified | e2e:select-answer.spec.ts (ungraded multi); unit:builder.editor-registry.test.ts | — |
| BLD-07 | Graded `select_answer` without a correct option, then explicit save | Blocked with "Slide N: …" | unit:builder.editor-registry.test.ts | P1 |
| BLD-08 | `type_answer` editor (accepted answers) | Validation and save | unit:builder.editor-registry.test.ts | P1 |
| BLD-09 | `wordcloud` editor (max entries) | Validation and save | unit:builder.editor-registry.test.ts | P1 |
| BLD-10 | `open_ended` editor | Validation and save | unit:builder.editor-registry.test.ts | P2 |
| BLD-11 | `scales` editor (statements, max, labels) | Validation and save | unit:builder.editor-registry.test.ts | P1 |
| BLD-12 | `ranking` editor (at least 2 items) | Validation and save | unit:builder.editor-registry.test.ts | P1 |
| BLD-13 | `guess_number` editor: range, step, graded correct value and tolerance | Saved; inline problems shown | e2e:advanced-slides.spec.ts, unit:slides.advanced.test.tsx | — |
| BLD-14 | `hundred_points` editor (2–10 items) | Saved | e2e:advanced-slides.spec.ts, unit:slides.advanced.test.tsx | — |
| BLD-15 | `grid_2x2` editor (items, axes, corners) | Saved | e2e:advanced-slides.spec.ts, unit:slides.advanced.test.tsx | — |
| BLD-16 | `pin_on_image` editor: https image, alt text required, graded area (drag or %) | Saved | e2e:advanced-slides.spec.ts (% fields), unit:slides.advanced.test.tsx | — |
| BLD-17 | `qna` slide: optional heading; no timer or scoring tabs | Saved | e2e:qna-reactions.spec.ts, unit:qna.components.test.tsx | — |
| BLD-18 | `heading` editor (title required) | Validation and save | unit:slides.content.test.tsx | P2 |
| BLD-19 | `paragraph` markdown-lite (bold, italic, http(s) and mailto links; unsafe links stripped) | Rendered safely | unit:slides.content.test.tsx, be:presentations/content.test.ts | P2 |
| BLD-20 | `bullets` (1–10) | Validation and save | unit:slides.content.test.tsx | P2 |
| BLD-21 | `image`: upload (storage on) or https link, alt required, fit, caption | Upload goes presign, PUT, complete; saved | unit:slides.content.test.tsx, unit:media.test.tsx, be:presentations/content.test.ts | P1 |
| BLD-22 | `big_number` (numbers only, prefix and suffix) | Validation and save | unit:slides.content.test.tsx | P2 |
| BLD-23 | `quote` | Validation and save | unit:slides.content.test.tsx | P2 |
| BLD-24 | `video`: YouTube or Vimeo link with `t=`, or uploaded file (storage) | Parsed id and start; privacy-enhanced embed | unit:media.test.tsx, unit:slides.content.test.tsx | P2 |
| BLD-25 | `instructions` (QR, code or text required) | Validation and save | unit:slides.content.test.tsx | P2 |
| BLD-26 | Settings tab: time limit, points, speed bonus; untimed allowed only on unscored slides; hidden for content | Rules enforced client- and server-side | unit:builder.editor-registry.test.ts, be:presentations/advanced.test.ts | P1 |
| BLD-27 | Inspector tab stays selected across slides; arrow, Home and End keys | Persisted; ARIA tabs | e2e:qna-reactions.spec.ts (persistence) | — |
| BLD-28 | Audience tab: Q&A on or off, moderation, anonymous, upvotes, reactions; saves on change; a new deck must be saved first | Deck settings persisted | e2e:qna-reactions.spec.ts, unit:qna.components.test.tsx | — |
| BLD-29 | Theme tab: presets, brand kits, accent override with contrast | Deck theme saved by PATCH; stage uses it | e2e:brand.spec.ts, unit:themes.test.tsx | — |
| BLD-30 | Speaker notes (up to 5,000 characters) | Saved; never sent to participants, public results or reports | e2e:ai-deck.spec.ts (kept), e2e:sessions.spec.ts (not leaked), be:presentations/registry.golden.test.ts | — |
| BLD-31 | AI "Quick slides": generate questions and merge them into the deck | Slides appended; invalid ones dropped | be:ai.generation.test.ts; e2e:ai-deck.spec.ts (tab visible only) | P1 |
| BLD-32 | AI "Whole deck": plan, review and edit the outline, write slides and notes, open in the builder | Draft deck; mock label persists until dismissed | e2e:ai-deck.spec.ts, be:integration/aiDeck.test.ts, unit:ai.deck.logic.test.ts | — |
| BLD-33 | AI form validation (short topic, no category) | Refused before any request | e2e:ai-deck.spec.ts | — |
| BLD-34 | AI with a real provider: failure, or a slide that stays invalid | 502 creates nothing; invalid slide dropped with a warning | be:integration/aiDeck.test.ts | P2 |
| BLD-35 | AI monthly quota reached | `PLAN_LIMIT_REACHED` message in the dialog; no model call | be:integration/aiDeck.test.ts, unit:ai.deck.logic.test.ts | P1 |
| BLD-36 | Import questions into the deck open in the builder | Appended after existing slides as a draft | e2e:imports.spec.ts | — |
| BLD-37 | Save draft on an unfinished deck | Gaps filled ("Untitled Question", "Option N"); API accepts it | unit:builder.editor-registry.test.ts | P1 |
| BLD-38 | Local draft autosave (250 ms) and restore after a reload or crash; silent backend draft on unmount | No edits lost | NONE | P0 |
| BLD-39 | "Present" button | Saves, then opens the host console on that deck | NONE | P0 |
| BLD-40 | Explicit save validation order | Title first, then the first failing slide with its position | unit:builder.editor-registry.test.ts | P1 |
| BLD-41 | Large decks: 1 MB JSON limit and the 50-slide cap | 413 or a clear message | be:http.createApp.test.ts, be:integration/imports.test.ts | P2 |
| BLD-42 | Save a deck while it is being presented | Defined behaviour (refuse or warn); live session not corrupted | NONE | P1 |
| BLD-43 | Leave the builder with unsaved changes | Local draft kept; no native "Leave site?" | NONE | P1 |
| BLD-44 | Media upload: type and size checks, presign, complete; storage-off explanation | Correct errors; asset recorded | unit:media.test.tsx, be:platform.storage.test.ts, be:platform.integration.test.ts | P1 |

## 6. Host console (HOST)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| HOST-01 | Open `/presentation/host/:id` on a deck never presented | "Ready to present"; no join code; code lookup 404; nothing auto-opened | e2e:live-flow.spec.ts | — |
| HOST-02 | Open lobby | Join code, QR, "0 JOINED", waiting text; code lookup 200 | e2e:live-flow.spec.ts | — |
| HOST-03 | Lobby updates as people join | Names and count live | e2e:live-flow.spec.ts | — |
| HOST-04 | Start from the lobby (no participants needed) | Slide 1 open on stage and phones | e2e:live-flow.spec.ts | — |
| HOST-05 | "Start presenting" without a lobby | Session active at slide 1; late joiners allowed | e2e:live-session.spec.ts, e2e:content-slides.spec.ts | — |
| HOST-06 | Close lobby (confirm) | Session ended from the lobby; phones see the ended screen | NONE | P1 |
| HOST-07 | Next and Prev buttons; Prev disabled on slide 1; the last slide offers End Session | Correct controls | e2e:live-session.spec.ts, e2e:live-flow.spec.ts, unit:live.surfaces.test.tsx | — |
| HOST-08 | Arrow keys, PageUp and PageDown; ignored with a modifier or inside inputs | Navigates only while active | e2e:live-session.spec.ts, e2e:content-slides.spec.ts (arrows only) | — |
| HOST-09 | Back and forward through visited slides | Stored phase and results shown; leaving an open slide closes it; no reopen on revisit | e2e:live-session.spec.ts, be:presentations/sessions.test.ts | — |
| HOST-10 | Close voting | Window closes; non-answerers locked out | e2e:live-session.spec.ts | — |
| HOST-11 | Reveal | Results and correct answer on stage; phones show result cards | e2e:live-session.spec.ts, e2e:select-answer.spec.ts | — |
| HOST-12 | Reopen after close or reveal | Fresh timer; earlier answers kept; those who answered cannot answer again | e2e:live-session.spec.ts | — |
| HOST-13 | Timed slide | Countdown on the server clock; auto-reveal at expiry (host timer and the server's 1.5 s worker) | e2e:live-flow.spec.ts, be:presentations/answerPath.test.ts, be:integration/liveScale.test.ts, unit:live.clock.test.ts | — |
| HOST-14 | Untimed slide | "No time limit"; never auto-reveals | e2e:live-session.spec.ts, unit:live.surfaces.test.tsx | — |
| HOST-15 | Live tally | "n / m answered" and distribution, coalesced every 250 ms | e2e:live-flow.spec.ts, be:presentations/answerPath.test.ts | — |
| HOST-16 | Content slide on stage | No voting chrome; phones "look at the screen" | e2e:content-slides.spec.ts, e2e:live-session.spec.ts | — |
| HOST-17 | Leaderboard slide | Standings on stage and phones | e2e:live-flow.spec.ts | — |
| HOST-18 | Header "Toggle Leaderboard" modal mid-session | Standings overlay opens and closes | NONE | P2 |
| HOST-19 | End Session, then confirm | Stage "Session ended" with final standings; phones "That's a wrap!" | e2e:live-flow.spec.ts (working tree confirms in the in-page dialog) | — |
| HOST-20 | End Session, then "Keep going" | Session keeps running | NONE | P2 |
| HOST-21 | Present again after the end | New run from slide 1 with nobody in it; first run kept in history | e2e:live-session.spec.ts, be:presentations/sessions.test.ts | — |
| HOST-22 | Return to a finished deck | Ended state with Present again and Open lobby; nothing auto-opened | e2e:live-session.spec.ts | — |
| HOST-23 | "Open lobby" from the ended state | New run waiting in its lobby | be:presentations/registry.golden.test.ts | P2 |
| HOST-24 | "Back to dashboard" from the end, not-found or forbidden screens | Navigates to the library | NONE | P2 |
| HOST-25 | Fullscreen with F and the button | Enters and leaves fullscreen | e2e:content-slides.spec.ts | — |
| HOST-26 | Reload the host console mid-question, on a revealed slide, on a content slide | Resumes slide, phase, timer, answers and results | e2e:live-session.spec.ts | — |
| HOST-27 | Socket drops and returns | "Reconnecting…"; rejoin and resync; lobby polls every 3 s while down | unit:live.reducer.test.ts, unit:live.store-and-slots.test.tsx | P0 |
| HOST-28 | A second host window or tab drives the same deck | Other window toasts `SESSION_ALREADY_LIVE` or `NO_LIVE_SESSION` and resyncs | unit:live.host-commands.test.ts | P1 |
| HOST-29 | Double click or held key on Next or Reveal | One command at a time; `SESSION_BUSY` retried once | unit:live.host-commands.test.ts | P2 |
| HOST-30 | Host page for a missing deck, or one the user may not host | "Presentation deck not found." or "You are not authorized to host this deck." | be:presentations/sessions.test.ts, be:integration/tenancy-isolation.test.ts | P1 |
| HOST-31 | Remove (kick) a participant | Not implemented (no route or UI); product gap | NONE | P1 |
| HOST-32 | Speaker notes while presenting | Not shown on the host console; product gap | NONE | P2 |
| HOST-33 | Copy join code or link from the lobby or header | Clipboard has the code or `/live/<code>`; toast | NONE | P2 |
| HOST-34 | Brand kit or theme on the stage | Deck tokens applied | e2e:brand.spec.ts | — |

## 7. Participant flow (PART)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| PART-01 | `/live`: enter a 6-digit code | Valid code goes to `/live/[code]`; bad format shows "Enter the 6-digit code"; unknown code shows "No live deck with that code" | NONE | P0 |
| PART-02 | Join by link or QR `/live/[code]`, enter a nickname | "You're in!" lobby with deck title and name | e2e:live-flow.spec.ts | — |
| PART-03 | Nickname empty or longer than 30 characters | "Please enter a nickname"; server caps at 30 | NONE | P1 |
| PART-04 | Rejoin pre-fills the last nickname | Value kept from the device record | e2e:live-session.spec.ts | — |
| PART-05 | Code of a deck never presented, or a draft | "Presentation Deck Not Found" | be:presentations/registry.golden.test.ts; e2e:live-flow.spec.ts (API 404 only) | P1 |
| PART-06 | Open the code after the session ended, with no prior identity | "This session has ended" | be:presentations/registry.golden.test.ts | P1 |
| PART-07 | Join past the audience cap | "This session is full."; rejoins still work | be:presentations/sessions.test.ts, be:integration/sessions.test.ts | P1 |
| PART-08 | Late join while a question is open | Current slide with the remaining time; can answer | e2e:live-session.spec.ts, unit:live.reducer.test.ts | — |
| PART-09 | Late join on a content, leaderboard or closed slide | Right state; no answer form on a closed slide | unit:live.reducer.test.ts | P2 |
| PART-10 | `select_answer` single: pick, Submit, reveal | "Answer locked in!", then "Correct!" with points and rank, or "Not quite…" | e2e:live-flow.spec.ts | — |
| PART-11 | `select_answer` multi-select (graded exact set) | Checkboxes; explanation after reveal | e2e:select-answer.spec.ts | — |
| PART-12 | `select_answer` ungraded | Results only, no right or wrong | e2e:select-answer.spec.ts | — |
| PART-13 | `type_answer`: type and submit | Graded against accepted answers; result after reveal | be:presentations/registry.golden.test.ts, be:presentations/live.integration.test.ts | P1 |
| PART-14 | `wordcloud`: up to N words; a pending draft is sent | "Response received!"; words on the stage cloud | e2e:live-flow.spec.ts, e2e:content-slides.spec.ts, unit:wordcloud.layout.test.ts | — |
| PART-15 | `open_ended` text response | Card wall on stage | be:presentations/registry.golden.test.ts, be:presentations/live.integration.test.ts | P1 |
| PART-16 | `scales` sliders (start mid-scale) | Averages on stage | e2e:live-flow.spec.ts | — |
| PART-17 | `ranking`: reorder by buttons or keyboard | Borda ranking on stage | be:presentations/registry.golden.test.ts, be:presentations/live.integration.test.ts | P1 |
| PART-18 | `guess_number` by slider or typed value; out of range or off step refused | Histogram; graded within tolerance | e2e:advanced-slides.spec.ts | — |
| PART-19 | `hundred_points` must total exactly 100 | Overshoot blocks submit; averages on stage | e2e:advanced-slides.spec.ts | — |
| PART-20 | `grid_2x2` by tap or keyboard; submit when every item is placed | Average positions on stage | e2e:advanced-slides.spec.ts | — |
| PART-21 | `pin_on_image` by tap or keyboard | Pins live; heatmap, area and score after reveal | e2e:advanced-slides.spec.ts | — |
| PART-22 | Leaderboard slide on the phone | Standings with "You" | e2e:live-flow.spec.ts | — |
| PART-23 | Content slides on the phone | "Look at the screen" (presenter pace) | e2e:live-session.spec.ts, unit:slides.content.test.tsx | — |
| PART-24 | Q&A board slide on screen | Q&A panel opens on phones | e2e:qna-reactions.spec.ts | — |
| PART-25 | Double tap or retried submit | Counted once (`clientAnswerId` replay) | be:presentations/answerPath.test.ts, be:integration/liveScale.test.ts, unit:live.store-and-slots.test.tsx | P1 |
| PART-26 | Try to change an answer after submitting | Not allowed; `ALREADY_ANSWERED` treated as submitted | unit:live.store-and-slots.test.tsx, be:presentations/registry.golden.test.ts | P2 |
| PART-27 | Answer just after the timer (750 ms grace; 15 s with a ticket on unscored slides; scored until the reveal) | Accepted inside the grace window; `TIME_UP` re-reads live state | be:presentations/answerPath.test.ts, be:presentations/registry.golden.test.ts, unit:live.store-and-slots.test.tsx | P1 |
| PART-28 | No answer when the slide closes or is revealed | "Voting is closed" or "Time's up!"; locked out | e2e:live-session.spec.ts, unit:live.surfaces.test.tsx | — |
| PART-29 | Refresh the phone mid-question, after answering, after reveal, on content | Same identity, answered state and result restored | e2e:live-session.spec.ts | — |
| PART-30 | Same device rejoins (new tab, or after clearing session credentials) | Same seat via the device token | be:presentations/registry.golden.test.ts, unit:live.participant-session.test.ts | P1 |
| PART-31 | Host presents again while the phone is on the old run | "A new session is live" with "Join the new session" (nickname pre-filled) | e2e:live-session.spec.ts | — |
| PART-32 | Stale or missing credentials (storage cleared, session over) | Credentials forgotten; rejoin form with "That session is over" hint | unit:live.reducer.test.ts, unit:live.store-and-slots.test.tsx | P1 |
| PART-33 | Kicked participant | "You were removed from this session", cannot rejoin (only reachable through data today) | be:presentations/answerPath.test.ts, be:presentations/sessions.test.ts, unit:live.store-and-slots.test.tsx | P2 |
| PART-34 | Phone network drop | "Reconnecting…"; answers retried with the same id (400 ms, 1.2 s); resync on reconnect or foreground | unit:live.store-and-slots.test.tsx | P0 |
| PART-35 | Answer rate limit (429) | Retried, then "Too many attempts" | be:presentations/answerPath.test.ts, be:integration/answerScript.test.ts, unit:live.store-and-slots.test.tsx | P2 |
| PART-36 | End screen | "That's a wrap!", final rank and score, "See my results" link | e2e:live-flow.spec.ts, unit:sessions.components.test.tsx (link) | — |
| PART-37 | `/live/[code]/summary?sid=` | Own answers, correctness, points, rank; newest session when `sid` is missing | e2e:sessions.spec.ts | — |
| PART-38 | Summary without a stored identity, or with a wrong token | Nothing revealed; link to `/live` | e2e:sessions.spec.ts | — |
| PART-39 | Summary while the session is live | Refreshes every 8 s; correctness after close, correct answer after reveal | unit:sessions.components.test.tsx | P2 |
| PART-40 | "Remove my answers" on an ended session | Confirm; erased on the server and the device; others keep their rank | e2e:sessions.spec.ts, be:integration/privacy.test.ts | — |
| PART-41 | Brand kit accent on phones | Phone uses the deck accent | e2e:brand.spec.ts | — |
| PART-42 | Join page on a workspace custom domain | Workspace name, logo and colours | unit:domains.test.ts (proxy only) | P2 |
| PART-43 | Deck settings `nickname` (optional or off), `showResultsOnDevices`, `audienceLocale` | Honoured; today there is no UI and the phone ignores them (product gap) | NONE | P2 |

## 8. Q&A and reactions (QNA)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| QNA-01 | Ask with moderation on | Pending; visible only to the author (with status) and the host | e2e:qna-reactions.spec.ts, be:integration/qna.test.ts | — |
| QNA-02 | Host approves a pending question | Appears in every list and on the board | e2e:qna-reactions.spec.ts | — |
| QNA-03 | Host rejects | Only host and author told; never reaches the audience | e2e:qna-reactions.spec.ts, be:integration/qna.test.ts | — |
| QNA-04 | Moderation off | Visible to everyone at once | be:integration/qna.test.ts | P1 |
| QNA-05 | Ask anonymously | No name anywhere (stage, phones, host) | e2e:qna-reactions.spec.ts, be:qna.views.test.ts | — |
| QNA-06 | Deck disallows anonymous questions | Option hidden; server refuses | be:integration/qna.test.ts, unit:qna.components.test.tsx | P2 |
| QNA-07 | Upvote others' questions (one each), not your own; remove an upvote | Counts propagate (coalesced `qna:votes`) | e2e:qna-reactions.spec.ts, be:integration/qna.test.ts | — |
| QNA-08 | Upvotes off for the deck | Buttons hidden; server refuses | be:integration/qna.test.ts, unit:qna.components.test.tsx | P2 |
| QNA-09 | Show on screen and hide; one highlight at a time | Overlay on the stage | e2e:qna-reactions.spec.ts, unit:qna.state.test.ts | — |
| QNA-10 | Mark answered, archive, pin; Top and New sort | Status markers; pinned first | e2e:qna-reactions.spec.ts (answered), be:integration/qna.test.ts, unit:qna.state.test.ts | — |
| QNA-11 | Empty, blank or over-long question; profanity | Refused; profanity masked | be:integration/qna.test.ts, be:qna.schema.test.ts, be:qna.profanity.test.ts | P2 |
| QNA-12 | Q&A off for the deck except while a Q&A slide is on screen | Tab and API open only then | be:integration/qna.test.ts, unit:qna.state.test.ts | P2 |
| QNA-13 | After the session ends | Panel closed with a reason; host list kept | be:integration/qna.test.ts, unit:qna.components.test.tsx | P2 |
| QNA-14 | Ask rate limit per participant | 429 with a message | be:integration/qna.test.ts | P2 |
| QNA-15 | Send a reaction | Floats up the stage (host room only); only the deck's emoji | e2e:qna-reactions.spec.ts, be:integration/qna.test.ts | — |
| QNA-16 | Reactions off, or the session ended | Bar hidden; server refuses | be:integration/qna.test.ts, unit:qna.components.test.tsx | P2 |
| QNA-17 | Reaction limits (5/s per socket, 300/s per session) | Excess dropped | be:reactions.limits.test.ts, be:integration/qna.test.ts | P2 |
| QNA-18 | Host Q&A drawer filters with counts; empty states | Pending tab offers approve and reject | e2e:qna-reactions.spec.ts, unit:qna.components.test.tsx | — |

## 9. Sessions (SES)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| SES-01 | History list: newest first, run number, status, participants, responses; load more | Correct rows and pagination | e2e:sessions.spec.ts, be:integration/sessions.reports.test.ts | — |
| SES-02 | Report: stat strip, a chart per response slide (StageView report), unreached slides listed, content slides excluded | Matches the run | e2e:sessions.spec.ts, unit:sessions.components.test.tsx, unit:sessions.query.test.ts | — |
| SES-03 | Leaderboard (10 rows, then show all); participants table search and paging (25) | Works; names render as text | e2e:sessions.spec.ts (search), unit:sessions.components.test.tsx | — |
| SES-04 | Report of a live session | Banner; refreshes every 5 s; Share and Delete wait for the end | e2e:sessions.spec.ts, unit:sessions.components.test.tsx | — |
| SES-05 | Speaker notes | Never in the report, public link or take-home | e2e:sessions.spec.ts, be:integration/sessions.reports.test.ts | — |
| SES-06 | CSV export (every plan) | `*-run-N.csv`; one row per participant and slide; formulas neutralised | e2e:sessions.spec.ts, be:sessions.export.test.ts | — |
| SES-07 | Excel and PDF export on Pro | Valid XLSX (PK) and PDF (%PDF) | e2e:sessions.spec.ts, be:sessions.export.test.ts | — |
| SES-08 | Excel or PDF on Free; server 403 `FEATURE_NOT_IN_PLAN` | Lock dialog "isn't part of your Free plan" | e2e:sessions.spec.ts, be:integration/sessions.reports.test.ts | — |
| SES-09 | Export of 200 participants | CSV and XLSX match the report and Mongo | be:integration/sessions.reports.test.ts | P2 |
| SES-10 | Export rate limit per user | 429 with a message | be:integration/sessions.reports.test.ts | P2 |
| SES-11 | Create a public link | `/r/<token>` opens signed out; no names by default; `noindex` | e2e:sessions.spec.ts | — |
| SES-12 | "Show participant names" | Leaderboard appears on `/r` | e2e:sessions.spec.ts | — |
| SES-13 | Link expiry (24 h, 7 d, 30 d, never) and "create a new link" | Expired or rotated links stop working | be:integration/sessions.reports.test.ts, unit:sessions.query.test.ts | P1 |
| SES-14 | Turn off the link | `/r` no longer shows results | e2e:sessions.spec.ts | — |
| SES-15 | `/r` with an invalid token; public rate limit | Not-found page; 429 per IP | be:integration/sessions.reports.test.ts | P2 |
| SES-16 | Delete a session (confirm) | Participants, answers and Redis state gone; shared link stops; back to history | e2e:sessions.spec.ts, be:integration/sessions.reports.test.ts | — |
| SES-17 | Take-home `/api/sessions/:sid/me` | Only with the matching participant token | e2e:sessions.spec.ts, be:integration/sessions.reports.test.ts | — |
| SES-18 | Retention purge | Ended sessions past retention deleted with participants and answers | be:integration/privacy.test.ts | P2 |
| SES-19 | Write-behind reconciliation at the end | Lost answers restored; totals exact; no double count | be:integration/sessions.test.ts, be:presentations/sessions.test.ts, be:presentations/answerPath.test.ts | P1 |
| SES-20 | "Present again" from the sessions list | Opens the host console ready for a new run | NONE | P2 |
| SES-21 | Presenter or viewer on the report | Export hidden without `session:export`; Share hidden without `session:share` | be:integration/sessions.reports.test.ts | P1 |
| SES-22 | Host end screen "Session report" link | Goes to `/presentations/[id]/sessions` | unit:sessions.components.test.tsx | P2 |

## 10. Quick polls (POLL)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| POLL-01 | `/create`: title, add and reorder questions, options (2–10), required toggle, phone preview | Builder state and preview match | NONE | P0 |
| POLL-02 | Save draft, then reopen it from the library (`/create?draftId=`) | Draft persisted and reloaded | NONE | P0 |
| POLL-03 | Publish settings (closes at, anonymous or identified, publish now) | Poll live; share link `/p/[id]`; library shows Active | NONE | P0 |
| POLL-04 | Builder validation: fewer than 2 options, short question, past expiry | Publish blocked with messages | NONE | P1 |
| POLL-05 | Trial (assessment): correct answers required, passing grade | Answerless trial cannot publish | be:polls.grading.test.ts, be:mcp.tools.test.ts | P1 |
| POLL-06 | "Generate with AI" draft in `/create` | Questions filled; errors handled | be:ai.contract.test.ts | P2 |
| POLL-07 | `/p/[id]` anonymous vote: step-by-step, required questions enforced | Thank-you state; counts updated | be:responses.security.test.ts, be:mvp.smoke.test.ts | P0 |
| POLL-08 | `/p/[id]` identified poll | Name and valid email before questions; guest token dedupes | be:responses.security.test.ts | P0 |
| POLL-09 | Vote again from the same device or ballot; concurrent double submit | Second vote refused; exactly one counted | be:responses.security.test.ts | P0 |
| POLL-10 | Anonymous votes capped per IP per poll | Refused past the cap | be:responses.security.test.ts | P1 |
| POLL-11 | Poll response cap from the plan | Refused when full; an upgrade lifts it at once | be:billing.pollCap.test.ts, be:integration/billing.http.test.ts | P1 |
| POLL-12 | Vote on a draft, closed or expired poll | "This poll has ended…" page; API refuses | be:responses.security.test.ts | P0 |
| POLL-13 | `/p/[id]` with an invalid or deleted id | "This link isn't valid." | NONE | P1 |
| POLL-14 | Trial respondent: score at the end, retries until passing, then stopped | Per the pass score | be:responses.security.test.ts | P1 |
| POLL-15 | Publish results from analytics | `/p/[id]` shows public results after voting or expiry | be:integration/polls.tenancy.test.ts | P1 |
| POLL-16 | Close a poll from analytics or the library | Voting stops at once; status Closed | be:integration/polls.tenancy.test.ts | P0 |
| POLL-17 | `/analytics/[id]`: stats, per-question charts, visualisation picker, top choice | Matches responses | NONE | P1 |
| POLL-18 | `/analytics/[id]` while votes arrive | Updates live over the socket (`analytics:update`) | be:realtime.modules.test.ts, be:integration/analyticsWorker.test.ts | P1 |
| POLL-19 | Voters tab: Everyone, Registered or Guests filter, search, view answers | Correct voters | NONE | P2 |
| POLL-20 | Edit a published poll; strip answer keys from a live assessment | Ordinary edits saved; answer-key removal refused | be:polls.grading.test.ts, be:integration/polls.tenancy.test.ts | P2 |
| POLL-21 | Delete a poll | Gone from the library; `/p/[id]` invalid | be:integration/polls.tenancy.test.ts | P1 |
| POLL-22 | Another user tries to read a draft, edit, close or delete | 403 or 404; the public read and voting stay open | be:integration/polls.tenancy.test.ts | P2 |
| POLL-23 | Poll created over MCP | Lands in the token owner's default workspace | be:integration/polls.tenancy.test.ts, be:mcp.tools.test.ts | P2 |

## 11. Analytics overview (ANL)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| ANL-01 | Headline numbers with change against the previous period | Sessions, Participants, Responses, Engagement | e2e:analytics.spec.ts, unit:analytics.overview.test.tsx, be:integration/insights.test.ts | — |
| ANL-02 | Range switch (7, 30, 90) and series switch | Refetches; chart changes | e2e:analytics.spec.ts | — |
| ANL-03 | Activity chart: zero-filled days in the viewer's time zone; tooltip | Every day present | be:integration/insights.test.ts; e2e:analytics.spec.ts (partial) | — |
| ANL-04 | Top content links | Decks to sessions, polls to `/analytics/[id]` | unit:analytics.overview.test.tsx | P2 |
| ANL-05 | Recent sessions | Link to the report; Live pill | unit:analytics.overview.test.tsx | P2 |
| ANL-06 | "N sessions and M polls live now" | Shown only when something runs | unit:analytics.overview.test.tsx | P2 |
| ANL-07 | "Responses per poll" list | Ranked bars; opens `/analytics/[id]` | NONE | P2 |
| ANL-08 | Workspace with no data | Quiet empty states; "nothing to compare" | unit:analytics.overview.test.tsx | P2 |
| ANL-09 | First load fails | Retry line; retry works | NONE | P2 |
| ANL-10 | Workspace scoping and switching | Only the current workspace; refetch on switch | be:integration/insights.test.ts | P2 |
| ANL-11 | Backwards, over-long or unknown range | 400 | be:integration/insights.test.ts | P2 |

## 12. Settings (SET)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| SET-01 | `/settings` and the section nav | Redirects to `/settings/profile`; gated entries show one-line reasons (capability, team only, plan, role) | unit:settings.sections.test.ts | P1 |
| SET-02 | Profile | Name editable (1–80 characters, sidebar and Home follow), email read only, avatar (initials fallback); change password with the current one (other devices signed out), or why not for Google/SSO-only accounts | e2e:profile.spec.ts, int:account.test.ts | P1 |
| SET-03 | Appearance Light, Dark or System (profile) and the sidebar theme toggle | Applies at once; persists on the device; System follows the OS | NONE | P1 |
| SET-04 | MCP: create a token (shown once), list, copy the client config, revoke | Token works until revoked; revoke has no confirm | be:integration/tenancy-isolation.test.ts (route guard only) | P1 |
| SET-05 | MCP client calls tools with the token | Scopes and workspace role enforced; rate limited | be:mcp.tools.test.ts, be:mcp.rateLimit.test.ts, be:mcp.publicUrl.test.ts | P2 |
| SET-06 | Privacy: download my data (3 per day) | Zip downloaded; counter decrements; no secrets inside | e2e:privacy.spec.ts, be:integration/privacy.test.ts | — |
| SET-07 | Privacy: delete account with a recent sign-in | Signed out; `/login?deleted=` shows the date | e2e:privacy.spec.ts | — |
| SET-08 | Privacy: delete when the last sign-in is over 5 minutes old | Password required (or "Log in again" without one); wrong password refused | be:integration/privacy.test.ts, unit:privacy.test.ts | P1 |
| SET-09 | Privacy: delete while sole owner of a team with members, or while a workspace still pays | Blocked, with links to Members or Billing | be:integration/privacy.test.ts | P1 |
| SET-10 | Account purge after 30 days | Account and personal workspaces deleted; shared content kept | be:integration/privacy.test.ts | P2 |
| SET-11 | Workspace: rename (owner or admin) | Saved; editors read only | be:integration/workspaces.http.test.ts | P2 |
| SET-12 | Workspace: data retention select capped by the plan | Saved; options capped | e2e:privacy.spec.ts, be:workspaces.service.test.ts, unit:privacy.test.ts | — |
| SET-13 | Workspace: plan limits and features, slug, type, role | Correct values | NONE | P2 |
| SET-14 | Create a team workspace (dialog) | Switches to it; a second single-seat free team workspace asks to upgrade | be:integration/workspaces.http.test.ts, be:workspaces.service.test.ts | P1 |
| SET-15 | Workspace switcher | Settings pages reload in place, others go Home; selection kept per user | unit:workspaces.store.test.ts, be:integration/workspaces.http.test.ts | P1 |
| SET-16 | Members: seats, invite by email and role; link shown when there is no mail; pending reserves a seat | Invitation created and listed | e2e:members.spec.ts | — |
| SET-17 | Members: change a role by rank; owners only by owners; non-managers read only | Enforced in UI and API | e2e:members.spec.ts, be:integration/members.http.test.ts, unit:workspaces.members.test.ts | — |
| SET-18 | Members: suspend and reactivate (reactivate needs a free seat) | Access lost at once; restored | be:integration/members.http.test.ts | P1 |
| SET-19 | Members: remove a member (shares removed); leave the workspace | Gone; audited | be:integration/members.http.test.ts | P1 |
| SET-20 | Members: transfer ownership | Primary owner only, to an active member | be:integration/members.http.test.ts | P1 |
| SET-21 | Revoke a pending invite; re-invite replaces the link; per-address rate limit | Old link dead | be:integration/members.http.test.ts | P2 |
| SET-22 | Invite beyond the seats | Refused with an upgrade message | be:integration/members.http.test.ts | P1 |
| SET-23 | Members in a personal workspace | Explanation and "Create a team workspace" | unit:settings.sections.test.ts | P2 |
| SET-24 | ShareDialog: add a member or group with a role, change, remove, save diff | Grants applied to that deck only | e2e:members.spec.ts, be:integration/members.http.test.ts, unit:workspaces.members.test.ts | — |
| SET-25 | Audit log: newest first, filter by action or person, clear, load older; non-admins refused | Readable rows | e2e:members.spec.ts, be:integration/members.http.test.ts | — |
| SET-26 | Brand: create a kit (colours with live contrast checks, fonts, chart colours) | Unreadable palettes block saving | e2e:brand.spec.ts, be:integration/brand-kits.test.ts | — |
| SET-27 | Brand: edit and delete a kit (in-page confirm) | Decks using it fall back to the preset | be:integration/brand-kits.test.ts | P1 |
| SET-28 | Brand: logo and stage background upload (storage on) | Shown on stage, phone and custom domain | NONE | P2 |
| SET-29 | Brand: "Theme for new decks" | New decks start on it | be:integration/brand-kits.test.ts | P2 |
| SET-30 | Brand gated by plan or role | Reason line; API 403 | be:integration/brand-kits.test.ts, unit:settings.sections.test.ts | P2 |
| SET-31 | SSO: SAML from metadata; values to copy; domain with DNS TXT; turn on | Connection on; discovery works | e2e:sso.spec.ts, be:integration/sso-scim.test.ts, unit:sso.test.tsx | — |
| SET-32 | SSO: OIDC connection | Secret stored encrypted and never returned | be:integration/sso-scim.test.ts, unit:sso.test.tsx | P2 |
| SET-33 | SSO: Test sign-in link; "Require single sign-on" | Off until a passed test; owner keeps password sign-in | be:integration/sso-scim.test.ts; e2e:sso.spec.ts (disabled state) | — |
| SET-34 | SSO: delete a connection | Confirm (native `window.confirm` today), then deleted | NONE | P1 |
| SET-35 | SCIM: create a token (shown once), use it, revoke (confirm) | Revoked token stops at once | e2e:sso.spec.ts, be:integration/sso-scim.test.ts | — |
| SET-36 | SCIM provisioning of users and groups | Create, deactivate, reactivate, delete; groups and members | be:integration/sso-scim.test.ts | P2 |
| SET-37 | Domains: add a hostname, CNAME and TXT to copy, Check DNS, remove (confirm) | Waiting for DNS, then removed | e2e:domains.spec.ts, be:integration/domains.test.ts | — |
| SET-38 | Domains: own or taken hostname refused; Live once records are found; stops when removed or the plan loses it | Status transitions | be:integration/domains.test.ts, be:domains.unit.test.ts | P2 |
| SET-39 | Billing with Stripe off | "Billing is off"; plan and usage still shown | e2e:billing.spec.ts | — |
| SET-40 | Billing checkout for Pro or Team (seats at least the members); success polling; canceled | Redirect to Checkout; plan confirmed; "nothing was charged" | e2e:billing.spec.ts (Stripe mocked), be:billing.service.test.ts, be:integration/billing.http.test.ts | — |
| SET-41 | Billing portal; past_due and scheduled-cancel banners | Portal opens; banners shown | unit:billing.components.test.tsx, be:billing.service.test.ts | P2 |
| SET-42 | Admin (not owner) opens Billing | "Requires the Owner role"; API 403 | unit:settings.sections.test.ts, be:integration/billing.http.test.ts | P2 |
| SET-43 | Stripe webhooks: upgrade, downgrade, payment failed, replays, concurrency | Plan state correct, exactly once | be:billing.webhook.test.ts, be:integration/billing.http.test.ts | P2 |
| SET-44 | Deep link to a gated page (for example `/settings/sso` on Free) | SectionUnavailable with the reason | unit:settings.sections.test.ts | P2 |

## 13. Imports (IMP)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| IMP-01 | Library Import, Questions CSV | Preview of rows to import and skip, with reasons; new deck; "Open the deck" | e2e:imports.spec.ts, be:imports.questions.test.ts, be:integration/imports.test.ts | — |
| IMP-02 | Questions XLSX | Same as CSV; title honoured | be:integration/imports.test.ts, be:imports.questions.test.ts | P1 |
| IMP-03 | Download the CSV and XLSX templates | Both download and re-import cleanly | e2e:imports.spec.ts, be:integration/imports.test.ts | — |
| IMP-04 | Non-spreadsheet, or missing type and question columns | Refused with a reason | e2e:imports.spec.ts, be:imports.questions.test.ts | — |
| IMP-05 | Encodings, semicolons, formulas, zip bombs, oversized files | Parsed safely or refused | be:imports.questions.test.ts | P2 |
| IMP-06 | Add questions to the deck open in the builder | Appended; 50-slide cap; refused while presenting | e2e:imports.spec.ts, be:integration/imports.test.ts | — |
| IMP-07 | PPTX upload (storage on) | Queued, running, done; deck with pictures and warnings; open deck | be:integration/imports.test.ts, be:imports.pptx.test.ts, unit:imports.ui.test.tsx | P1 |
| IMP-08 | PDF upload | One image slide per page, text in notes and alt; password-protected refused | be:integration/imports.test.ts, be:imports.pdf.test.ts | P1 |
| IMP-09 | Google Slides public link; private link; malformed link | Imported; "private" error; format refused | be:integration/imports.test.ts, be:imports.gslides.test.ts; e2e:imports.spec.ts (format check only) | — |
| IMP-10 | Google Drive picker for a private file (when configured) | Imported with the picker token, which is then forgotten | be:integration/imports.test.ts | P2 |
| IMP-11 | Storage off | PPTX and PDF explain why; Google link still offered | e2e:imports.spec.ts, unit:imports.ui.test.tsx | — |
| IMP-12 | Client file checks (extension, mismatched type, empty, oversized) | Refused before upload | unit:imports.logic.test.ts | P2 |
| IMP-13 | Failure paths: not a presentation, renderer down, transient retries, more than 50 slides | Readable reason and Retry; fallback with a warning; truncated with a warning | be:integration/imports.test.ts, unit:imports.ui.test.tsx | P2 |
| IMP-14 | `importsPerMonth` quota reached | Refused with a plan message; a repeated request for a running job counts once | be:integration/imports.test.ts | P1 |
| IMP-15 | Job polling deadline, abort, flaky reads | Gives up cleanly | unit:imports.logic.test.ts | P2 |
| IMP-16 | Jobs and sources of other users or workspaces | Not visible; refused | be:integration/imports.test.ts | P2 |
| IMP-17 | Presenter or viewer tries to import | Refused (`deck:create`) | be:integration/imports.test.ts | P2 |

## 14. Role-based access (RBAC)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| RBAC-01 | Owner across decks, sessions, members, billing, SSO, domains, brand | Everything allowed | e2e:members.spec.ts, e2e:billing.spec.ts (owner flows); be:platform.policy.test.ts | — |
| RBAC-02 | Admin: everything except billing | Billing nav reason; checkout and portal 403 | be:integration/billing.http.test.ts, be:platform.policy.test.ts, unit:settings.sections.test.ts | P1 |
| RBAC-03 | Admin invites or assigns roles up to admin, never owner | Enforced | be:integration/members.http.test.ts, unit:workspaces.members.test.ts | P2 |
| RBAC-04 | Editor: create, edit, delete, host and share decks; export and share sessions; no members, audit, brand, SSO or billing | UI hides admin actions; API 403 | e2e:members.spec.ts, be:platform.policy.test.ts | — |
| RBAC-05 | Presenter: read and host decks, export results; no create, edit, delete or share | Host console works; no edit or delete affordances | be:integration/tenancy-isolation.test.ts, be:integration/members.http.test.ts | P0 |
| RBAC-06 | Presenter or viewer opens the builder (`?id=`) | Read-only, or a clear refusal; save 403 explained | NONE | P1 |
| RBAC-07 | Viewer: read decks and reports only; host console says "not authorized"; no Export | Enforced in UI and API | e2e:members.spec.ts (API: edit 403, read 200), be:integration/tenancy-isolation.test.ts | — |
| RBAC-08 | Viewer or presenter in the library and on Home | Edit, Present, Delete and Share hidden or disabled according to permissions | NONE | P1 |
| RBAC-09 | Resource share raises a viewer to editor on one deck | Can edit that deck only; cannot delete or re-share | e2e:members.spec.ts, be:tenancy.shares.test.ts | — |
| RBAC-10 | Group shares and folder shares | Apply to the decks they cover | be:integration/members.http.test.ts, be:tenancy.shares.test.ts | P2 |
| RBAC-11 | Suspended or pending (invited) member | No access at once | be:integration/members.http.test.ts, be:platform.policy.test.ts | P1 |
| RBAC-12 | Removed from the selected workspace while using it | `WORKSPACE_FORBIDDEN`: selection cleared, reads replayed in the default workspace, writes not replayed | unit:workspaces.store.test.ts, be:integration/workspaces.http.test.ts | P1 |
| RBAC-13 | Cross-workspace access to every deck, poll, share, session, upload and audit route | Denied | be:integration/tenancy-isolation.test.ts | P2 |
| RBAC-14 | Host socket join by a non-host role or another workspace | Refused | be:integration/tenancy-isolation.test.ts, be:realtime.modules.test.ts | P2 |
| RBAC-15 | Participant (anonymous) | Never reaches host routes, answer keys or notes | be:presentations/registry.golden.test.ts, be:realtime.modules.test.ts | P2 |
| RBAC-16 | Settings nav gating per role (Brand, SSO, SCIM, Domains and Audit need admin; Billing needs owner) | Reason lines | unit:settings.sections.test.ts | P2 |
| RBAC-17 | Session report actions by role (read for all; export not for viewer; share not for presenter or viewer) | Enforced | be:integration/sessions.reports.test.ts | P1 |

## 15. Plan limits (PLAN)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| PLAN-01 | Audience cap reached (snapshot at open) | 403 `SESSION_FULL`; phone "This session is full"; rejoins still work | be:presentations/sessions.test.ts, be:integration/sessions.test.ts | P1 |
| PLAN-02 | Plan upgraded during an open session | Open session keeps its snapshot cap | be:integration/sessions.test.ts | P2 |
| PLAN-03 | Poll response cap | Refused past the cap; upgrade lifts it at once | be:billing.pollCap.test.ts, be:integration/billing.http.test.ts | P1 |
| PLAN-04 | AI decks per month | Quota message; mock mode and failed calls not counted | be:integration/aiDeck.test.ts, be:platform.plans.test.ts | P1 |
| PLAN-05 | Imports per month | Quota message | be:integration/imports.test.ts | P1 |
| PLAN-06 | Seats: invite, accept or reactivate beyond seats; Team checkout seats; seat sync to Stripe | Refused or raised as specified | be:integration/members.http.test.ts, be:integration/members.seats.test.ts, be:integration/billing.http.test.ts; e2e:billing.spec.ts (Team seats) | — |
| PLAN-07 | Export formats: Free has CSV only; Pro has XLSX and PDF | Lock dialog, or a download | e2e:sessions.spec.ts | — |
| PLAN-08 | Brand kits on paid plans only; preset fallback after a downgrade | Enforced | be:integration/brand-kits.test.ts | P2 |
| PLAN-09 | SSO, SCIM and custom domains: Enterprise plus the server capability | Gated in nav and API | be:integration/sso-scim.test.ts, be:integration/domains.test.ts, unit:settings.sections.test.ts | P2 |
| PLAN-10 | Retention options capped by the plan | Enforced | be:workspaces.service.test.ts, unit:privacy.test.ts | P2 |
| PLAN-11 | Free: one single-seat team workspace, then an upgrade prompt | Enforced | be:workspaces.service.test.ts | P2 |
| PLAN-12 | Per-workspace `planOverrides` | Override features and limits | be:platform.plans.test.ts | P2 |
| PLAN-13 | Usage card (allowances, usage, unlimited, audience cap) | Correct numbers | unit:billing.components.test.tsx; e2e:billing.spec.ts | — |
| PLAN-14 | Downgrade (subscription deleted) | Exports lock, brand kits fall back, domains stop, seats cleared | be:billing.webhook.test.ts, be:integration/domains.test.ts, be:integration/brand-kits.test.ts | P1 |

## 16. Error and edge states (ERR)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| ERR-01 | Unknown URL | Branded 404 (`not-found.tsx`) | NONE | P1 |
| ERR-02 | Render error | `error.tsx` or `global-error.tsx` with retry | NONE | P2 |
| ERR-03 | API down while using the dashboard (library, home, settings, report) | Error and retry states, no blank page or infinite spinner | NONE | P1 |
| ERR-04 | API down for a phone mid-session | Keeps the screen, retries, resyncs on recovery | unit:live.store-and-slots.test.tsx | P1 |
| ERR-05 | Several requests get 401 at once | A single refresh; every request retried | NONE | P1 |
| ERR-06 | 403 on an action (role changed meanwhile) | Readable toast; UI recovers | NONE | P2 |
| ERR-07 | Missing resources: deck id in builder, host or sessions; invalid `/r` token; invalid `/p` id; invalid invite | Clear not-found states | e2e:sessions.spec.ts (deleted `/r` only) | — |
| ERR-08 | 429 from login, register, AI (20 per 5 min), imports, public results, invites | Friendly messages | be:rateLimit.middleware.test.ts, be:integration/aiDeck.test.ts, be:integration/sessions.reports.test.ts, be:integration/members.http.test.ts | P2 |
| ERR-09 | Rate limiter's Redis down | Participant routes fail open; strict routes 503 | be:rateLimit.middleware.test.ts | P2 |
| ERR-10 | Malformed JSON, oversized body, disallowed CORS origin | 400, 413, 403 | be:http.errors.test.ts | P2 |
| ERR-11 | Empty states: library, home, analytics, sessions, report without response slides, Q&A, audit | Helpful copy and CTAs | unit:library.query.test.ts, unit:analytics.overview.test.tsx, unit:sessions.components.test.tsx, unit:qna.components.test.tsx | P2 |
| ERR-12 | Long text: deck or poll titles, 2,000-character paragraph, 500-character Q&A, 30-character nicknames, long options | Wraps on stage, phone, cards and report; no overflow | be:presentations/content.test.ts, be:qna.schema.test.ts (limits only) | P2 |
| ERR-13 | HTML or markup in user text (titles, options, names, Q&A, paragraphs) | Rendered as text everywhere | be:presentations/content.test.ts, unit:slides.content.test.tsx, unit:sessions.components.test.tsx | P1 |
| ERR-14 | Many participants: 200+ in the lobby and on the leaderboard; 1,000 answering | Host UI stays responsive; counts exact | be:integration/liveScale.test.ts, be:integration/sessions.reports.test.ts, be:integration/multiInstance.test.ts | P1 |
| ERR-15 | Several backend instances | Every event delivered once; host updates coalesced | be:realtime.integration.test.ts, be:integration/multiInstance.test.ts | P2 |
| ERR-16 | Redis loses keys mid-session | Answer windows and distributions rebuilt from Mongo | be:presentations/registry.golden.test.ts, be:presentations.distribution.test.ts | P2 |
| ERR-17 | Storage disabled | Upload paths explain `STORAGE_DISABLED` | e2e:imports.spec.ts, be:platform.storage.test.ts, unit:media.test.tsx | — |
| ERR-18 | Mail disabled | Invite link shown to copy; sign-up still completes | e2e:members.spec.ts (invite part) | — |
| ERR-19 | Phone clock skew | Deadlines follow the server clock | unit:live.clock.test.ts | P2 |

## 17. Responsive, theme and accessibility (UX)

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| UX-01 | Landing and auth pages at 375, 768 and 1280 px | No horizontal scroll | e2e:landing-auth.spec.ts | — |
| UX-02 | Participant flow at phone size (375×812, touch) for every slide type, the join form, the end screen and the summary | Usable; no overflow; 44 px targets | NONE | P0 |
| UX-03 | `/p/[id]` voting at phone size | Usable; no overflow | NONE | P1 |
| UX-04 | Dashboard (home, library, settings, report, analytics) at phone and tablet sizes | Sidebar collapses; no overflow | NONE | P1 |
| UX-05 | Builder below `lg` and `xl` | Rail on top; inspector under the stage | NONE | P2 |
| UX-06 | Host console at tablet and projector sizes | 16:9 stage scales; controls reachable | NONE | P2 |
| UX-07 | Dark mode across the app; System follows the OS; deck tokens readable | No unreadable surfaces | unit:theme.tokens.test.ts (deck tokens only) | P2 |
| UX-08 | Landing and auth keyboard (skip link, menu Escape, FAQ, login focus order) | Correct | e2e:landing-auth.spec.ts | — |
| UX-09 | Host keyboard (arrows, F) | Correct | e2e:live-session.spec.ts, e2e:content-slides.spec.ts | — |
| UX-10 | Participant keyboard answering (slider, grid, pin, spinbuttons) | Correct | e2e:advanced-slides.spec.ts, e2e:live-flow.spec.ts | — |
| UX-11 | Builder keyboard (rail, inspector tabs, picker) | Correct | NONE | P2 |
| UX-12 | Dialogs trap focus, close on Escape and return focus | Correct | e2e:sessions.spec.ts (Escape only) | — |
| UX-13 | Accessible names (reaction buttons, QR `aria-label`, icon buttons) and live regions | Present | unit:qna.components.test.tsx (reactions) | P2 |
| UX-14 | Reduced motion (landing, word cloud, reactions, theme transition) | Animations reduced | NONE | P2 |
| UX-15 | Contrast of presets and brand kits | WCAG ratios met | be:themes.test.ts, unit:themes.test.tsx | P2 |

## 18. Native window.confirm, alert and prompt (DLG)

At HEAD, `git grep` finds four `window.confirm` calls and no `alert` or `prompt`. Embedded browsers (in-app panes, webviews) suppress these and answer "no". At HEAD, the e2e helpers auto-accepted native dialogs, so suppression was never tested.

| ID | Scenario | Expected result | Coverage | Pri |
|---|---|---|---|---|
| DLG-01 | Host End Session or Close lobby (`useHostSession.ts:206` at HEAD) | Working tree (uncommitted) moves it to the in-page `EndSessionDialog`; fixtures now dismiss native dialogs so a regression fails | e2e:live-flow.spec.ts, e2e:live-session.spec.ts, e2e:content-slides.spec.ts (working tree) | — |
| DLG-02 | Remove a custom domain (`DomainsSettings.tsx:69` at HEAD) | Working tree uses an in-page `ConfirmDialog` | e2e:domains.spec.ts (working tree) | — |
| DLG-03 | Revoke a SCIM token (`ScimSettings.tsx:134` at HEAD) | Working tree uses an in-page `ConfirmDialog` | e2e:sso.spec.ts (working tree) | — |
| DLG-04 | Delete an SSO connection (`ConnectionCard.tsx:450`, still native in the working tree) | Should be an in-page confirm; today it is a no-op inside embedded browsers | NONE | P1 |
| DLG-05 | Revoke an MCP token (`McpSettingsSection.tsx`) | No confirmation at all; should confirm in-page | NONE | P2 |
| DLG-06 | Leave the builder with edits | Draft saved silently in `beforeunload`; no native prompt by design | NONE | P2 |
