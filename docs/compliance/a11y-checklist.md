# Accessibility checklist (W4-A)

What was checked on the live surfaces, how, what was found and fixed, and what is still open.
Target: **WCAG 2.2 level AA**. Acceptance of the package: **zero serious or critical axe findings on
the participant and presenter core flows** (met, in a light and in a dark deck, see Results).

Surfaces in scope: the participant phone (`/live`, `/live/<code>`, the results page
`/live/<code>/summary`), the stage and host console (`/presentation/host/<id>`), the presenter view and
the audience window (`/presentation/<id>/presenter|present`), the phone remote (`/remote/<token>`),
audience pace (the participant's own run and the host's dashboard), plus the public entry pages
(landing, login, signup). The builder, library and settings were not audited (see Known gaps).

How the code does it: `frontend/docs/wiki/features/live-surfaces.md`, section "Accessibility (W4-A)".

## How it is checked

| Check | How | Where |
| --- | --- | --- |
| Automated rules | axe-core 4.14 through `@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa best-practice`, whole page, after animations settle. Serious or critical fails the test; every finding of any impact is written to `test-results/axe/findings.jsonl`. | `frontend/e2e/axe.ts`, `a11y-live.spec.ts`, `a11y-audience-pace.spec.ts`, `a11y-public.spec.ts` |
| Both deck themes | Every live scan runs in a light and a dark deck (`theme.mode`); public pages in the light and the dark app theme, on a phone (390 px) and a desktop. | same |
| Every slide type | The 18 slide types (10 response, 8 content), open, answered and revealed, on the phone and the stage. | `a11y-live.spec.ts` |
| Keyboard and focus | Real keys only: join, answer, submit, ranking moves, dialogs (trap, Escape, focus back), the Q&A drawer, the slide keys after a dialog. Focus asserted with `toBeFocused()`. | `a11y-keyboard.spec.ts` |
| Announcements | The announcer's polite region text after each event (new slide, answer locked in, result with points and rank), the timer's milestone region ("10 seconds left", not every second), the ranking region. | `a11y-keyboard.spec.ts`, `tests/unit/a11y.test.tsx` |
| Reduced motion | `reducedMotion: "reduce"` context: computed `animation-duration` of the stage's entrance animations under 1 ms, pulses run once. | `a11y-keyboard.spec.ts` |
| Reflow and zoom | 320 px phone (join page, lobby, question, after the reveal, the remote) and 200 % zoom of a 1280×720 window (640×360 CSS px: host console, presenter view): `scrollWidth ≤ innerWidth`. | `a11y-keyboard.spec.ts` |
| Touch targets | Every visible enabled control in the phone's `main` (lobby, a question, ranking) and on the remote measured at 44×44 CSS px or more. | `a11y-keyboard.spec.ts` |
| Contrast from tokens | Unit test on `tokens.css`: text tokens 4.5:1 on the stage and its panels in both modes (now also `stage-muted`, `primary-ink`), marks 3:1. | `tests/unit/theme.tokens.test.ts` |
| Other engines | The axe and keyboard specs once in WebKit through the Docker Playwright server (`E2E_BROWSERS=webkit E2E_PW_SERVER=…`). | see Results |

Run them (after `next build` with the e2e `NEXT_PUBLIC_*`, as CI does):

```bash
cd frontend
E2E_FRONTEND_MODE=start bun x playwright test e2e/a11y-*.spec.ts
python3 - <<'EOF'   # what axe found, per scan
import json; [print(r["surface"], [f["id"] for f in r["findings"]]) for r in map(json.loads, open("test-results/axe/findings.jsonl"))]
EOF
```

## Results

Measured on 2026-11-05/06 against a production build (`next build` + `next start`, as CI runs it), Chromium
(system Chromium 155 through Playwright 1.64), the same 250 scans before the fixes (branch
`feat/light-deck-themes`) and after them (`feat/accessibility`). "Failing" = scans with at least one
serious or critical finding.

| Surface family (light + dark) | Scans | Failing before | Failing after | Rules found before |
| --- | --- | --- | --- | --- |
| Public pages (landing, login, signup, join page) | 20 | 10 | 0 | svg-img-alt (serious) ×8, color-contrast (serious) ×6 |
| Participant, own pace (waiting, question, answered, summary, result, review, closed) | 16 | 7 | 0 | color-contrast (serious) ×7 |
| Participant, every slide type (open, answered, revealed) | 72 | 46 | 0 | color-contrast (serious) ×45, button-name (critical) ×2 |
| Participant, core flow (join, lobby, answer, results, end, results page) | 20 | 7 | 0 | color-contrast (serious) ×7 |
| Host console, every slide type (open, revealed) | 56 | 4 | 0 | color-contrast (serious) ×2, scrollable-region-focusable (serious) ×2 |
| Host console, core flow (ready, lobby, slide, reveal, leaderboard, dialog, end) | 16 | 4 | 0 | color-contrast (serious) ×4 |
| Audience dashboard (host console and presenter view) | 14 | 6 | 0 | color-contrast (serious) ×6 |
| Presenter view (ready, pairing, lobby, slide, reveal, end) | 12 | 12 | 0 | color-contrast (serious) ×12, scrollable-region-focusable (serious) ×12, label-content-name-mismatch (serious) ×2 |
| Audience window (stage and own-pace stage) | 14 | 0 | 0 | – |
| Phone remote | 10 | 6 | 0 | color-contrast (serious) ×6 |

**Before:** 102 of 250 scans failed: `color-contrast` in 95 scans (muted stage text at 40–60 % opacity of the
ink, the ember as text on paper and on its own tints, green and red text on tints, sonner's rich-colour
toasts), `scrollable-region-focusable` in 14 (the presenter view's Q&A list, a revealed slide with an
explanation), `svg-img-alt` in 8 (unnamed QR codes on the landing and sign-in pages),
`label-content-name-mismatch` in 2 ("+30 s" named "Add 30 seconds"), and the only critical one,
`button-name` in 2 (ranking's up / down buttons had no name). **After: 0 of 250.** The axe scans pass on
every surface in both deck themes; the acceptance bar (zero serious or critical on the participant and
presenter core flows) is met.

Moderate findings left (not blocking, listed per scan in `findings.jsonl`): only `region`, in the 12
presenter-view scans: its left column (stage, countdown switch, controls) is outside a landmark because the
stage's `main` sits inside it, and making the column a region would nest `main`. Fixed on the way, though
moderate or minor: empty stage headings on content slides, `main` and `h1` on the remote, the nickname form
and the participant notices, the audience window's title and hint in a banner, two Q&A regions sharing a
name.

**WebKit** (Playwright 1.64.1 Docker image, `mcr.microsoft.com/playwright:v1.64.1-noble`, `E2E_BROWSERS=webkit E2E_PW_SERVER=ws://127.0.0.1:3333/`): the same 250 scans, **0 serious or critical**, the same 12 moderate `region` findings; all four a11y specs passed there, `a11y-keyboard.spec.ts` included
(13 of 13 tests, 7.5 min). Firefox was not run.

Every other check of the table above passed in Chromium: `a11y-keyboard.spec.ts` (3 tests), the token
contrast test, `tests/unit/a11y.test.tsx`. The full e2e suite (124 tests) passed on a build of these
changes; after the last landmark fixes the specs they touch were run again (the a11y specs, presenter,
participant join and mobile, live flow and session, content slides, embeds, audience pace, Q&A: all passed).

<details>
<summary>Every surface, light and dark: serious + critical rule findings, before → after</summary>

| Surface | Light: before → after | Dark: before → after |
| --- | --- | --- |
| audience dashboard · not open | 0 → 0 | 0 → 0 |
| audience dashboard · lobby | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant own pace · waiting | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant own pace · question | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant own pace · answered | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| audience dashboard · open with progress | 0 → 0 | 0 → 0 |
| presenter view · audience dashboard | 0 → 0 | 0 → 0 |
| audience window · own pace stage | 0 → 0 | 0 → 0 |
| participant own pace · content slide | 0 → 0 | 0 → 0 |
| participant own pace · summary | 0 → 0 | 0 → 0 |
| participant own pace · result | 1 (color-contrast) → 0 | 0 → 0 |
| participant own pace · review (right, results) | 0 → 0 | 0 → 0 |
| audience dashboard · close dialog | 0 → 0 | 0 → 0 |
| audience dashboard · closed | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant own pace · closed | 0 → 0 | 0 → 0 |
| audience window · own pace closed | 0 → 0 | 0 → 0 |
| audience dashboard · ended | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · ready | 0 → 0 | 0 → 0 |
| presenter view · ready | 2 (color-contrast, scrollable-region-focusable) → 0 | 2 (color-contrast, scrollable-region-focusable) → 0 |
| audience window · ready | 0 → 0 | 0 → 0 |
| presenter view · remote pairing | 2 (color-contrast, scrollable-region-focusable) → 0 | 2 (color-contrast, scrollable-region-focusable) → 0 |
| phone remote · not started | 0 → 0 | 0 → 0 |
| host console · lobby | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant · join form | 0 → 0 | 0 → 0 |
| participant · lobby | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| presenter view · lobby | 2 (color-contrast, scrollable-region-focusable) → 0 | 2 (color-contrast, scrollable-region-focusable) → 0 |
| audience window · lobby | 0 → 0 | 0 → 0 |
| phone remote · lobby | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · slide open | 0 → 0 | 0 → 0 |
| participant · answering (select answer) | 0 → 0 | 0 → 0 |
| presenter view · slide open | 3 (color-contrast, label-content-name-mismatch, scrollable-region-focusable) → 0 | 3 (color-contrast, label-content-name-mismatch, scrollable-region-focusable) → 0 |
| audience window · slide open | 0 → 0 | 0 → 0 |
| phone remote · slide open | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant · answer locked in | 0 → 0 | 0 → 0 |
| host console · reveal | 0 → 0 | 0 → 0 |
| participant · result correct | 0 → 0 | 0 → 0 |
| participant · result wrong | 0 → 0 | 0 → 0 |
| presenter view · reveal | 2 (color-contrast, scrollable-region-focusable) → 0 | 2 (color-contrast, scrollable-region-focusable) → 0 |
| audience window · reveal | 0 → 0 | 0 → 0 |
| phone remote · reveal | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · content slide | 0 → 0 | 0 → 0 |
| participant · look at the screen | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · leaderboard | 0 → 0 | 0 → 0 |
| participant · leaderboard | 1 (color-contrast) → 0 | 0 → 0 |
| host console · end session dialog | 0 → 0 | 0 → 0 |
| host console · end | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant · end | 0 → 0 | 0 → 0 |
| presenter view · end | 2 (color-contrast, scrollable-region-focusable) → 0 | 2 (color-contrast, scrollable-region-focusable) → 0 |
| audience window · end | 0 → 0 | 0 → 0 |
| phone remote · end | 0 → 0 | 0 → 0 |
| participant · my results page | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · wordcloud | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant · wordcloud | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| participant · wordcloud answered | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · wordcloud revealed | 0 → 0 | 0 → 0 |
| participant · wordcloud revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · scales | 0 → 0 | 0 → 0 |
| participant · scales | 1 (color-contrast) → 0 | 0 → 0 |
| participant · scales answered | 1 (color-contrast) → 0 | 0 → 0 |
| host console · scales revealed | 0 → 0 | 0 → 0 |
| participant · scales revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · open_ended | 0 → 0 | 0 → 0 |
| participant · open_ended | 1 (color-contrast) → 0 | 0 → 0 |
| participant · open_ended answered | 1 (color-contrast) → 0 | 0 → 0 |
| host console · open_ended revealed | 0 → 0 | 0 → 0 |
| participant · open_ended revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · ranking | 0 → 0 | 0 → 0 |
| participant · ranking | 2 (button-name, color-contrast) → 0 | 1 (button-name) → 0 |
| participant · ranking answered | 1 (color-contrast) → 0 | 0 → 0 |
| host console · ranking revealed | 0 → 0 | 0 → 0 |
| participant · ranking revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · type_answer | 0 → 0 | 0 → 0 |
| participant · type_answer | 1 (color-contrast) → 0 | 0 → 0 |
| participant · type_answer answered | 1 (color-contrast) → 0 | 0 → 0 |
| host console · type_answer revealed | 0 → 0 | 0 → 0 |
| participant · type_answer revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · select_answer | 0 → 0 | 0 → 0 |
| participant · select_answer | 1 (color-contrast) → 0 | 0 → 0 |
| participant · select_answer answered | 1 (color-contrast) → 0 | 0 → 0 |
| host console · select_answer revealed | 1 (scrollable-region-focusable) → 0 | 1 (scrollable-region-focusable) → 0 |
| participant · select_answer revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · guess_number | 0 → 0 | 0 → 0 |
| participant · guess_number | 1 (color-contrast) → 0 | 0 → 0 |
| participant · guess_number answered | 1 (color-contrast) → 0 | 0 → 0 |
| host console · guess_number revealed | 0 → 0 | 0 → 0 |
| participant · guess_number revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · hundred_points | 0 → 0 | 0 → 0 |
| participant · hundred_points | 1 (color-contrast) → 0 | 0 → 0 |
| participant · hundred_points answered | 1 (color-contrast) → 0 | 0 → 0 |
| host console · hundred_points revealed | 0 → 0 | 0 → 0 |
| participant · hundred_points revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · grid_2x2 | 0 → 0 | 0 → 0 |
| participant · grid_2x2 | 1 (color-contrast) → 0 | 0 → 0 |
| host console · grid_2x2 revealed | 0 → 0 | 0 → 0 |
| participant · grid_2x2 revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · pin_on_image | 0 → 0 | 0 → 0 |
| participant · pin_on_image | 1 (color-contrast) → 0 | 0 → 0 |
| host console · pin_on_image revealed | 0 → 0 | 0 → 0 |
| participant · pin_on_image revealed | 1 (color-contrast) → 0 | 0 → 0 |
| host console · qna | 0 → 0 | 0 → 0 |
| participant · qna | 1 (color-contrast) → 0 | 0 → 0 |
| host console · paragraph | 0 → 0 | 0 → 0 |
| participant · paragraph | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · bullets | 0 → 0 | 0 → 0 |
| participant · bullets | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · image | 0 → 0 | 0 → 0 |
| participant · image | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · big_number | 0 → 0 | 0 → 0 |
| participant · big_number | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · quote | 0 → 0 | 0 → 0 |
| participant · quote | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · video | 0 → 0 | 0 → 0 |
| participant · video | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| host console · instructions | 0 → 0 | 0 → 0 |
| participant · instructions | 1 (color-contrast) → 0 | 1 (color-contrast) → 0 |
| landing · phone | 2 (color-contrast, svg-img-alt) → 0 | 2 (color-contrast, svg-img-alt) → 0 |
| login · phone | 0 → 0 | 0 → 0 |
| signup · phone | 0 → 0 | 0 → 0 |
| join page · phone | 0 → 0 | 0 → 0 |
| join page · invalid code · phone | 1 (color-contrast) → 0 | 0 → 0 |
| landing · desktop | 2 (color-contrast, svg-img-alt) → 0 | 2 (color-contrast, svg-img-alt) → 0 |
| login · desktop | 1 (svg-img-alt) → 0 | 1 (svg-img-alt) → 0 |
| signup · desktop | 1 (svg-img-alt) → 0 | 1 (svg-img-alt) → 0 |
| join page · desktop | 0 → 0 | 0 → 0 |
| join page · invalid code · desktop | 1 (color-contrast) → 0 | 0 → 0 |

Before: 250 scans, 102 with a serious or critical finding (121 rule findings). After: 250 scans, 0 (0).

</details>

## WCAG 2.2 AA criteria

| Criterion | Status | Notes |
| --- | --- | --- |
| 1.1.1 Non-text content | Pass | Icons are `aria-hidden` (lucide default, hugeicons in toasts set explicitly); QR codes on live surfaces are named ("QR code to join …"), the landing's sample QR codes are hidden as illustration; slide images use their `alt`. |
| 1.3.1 Info and relationships | Pass | Headings per screen (participant `h1` deck title, `h2` slide question), lists for rankings, participants and lobby names, tables with `th scope`, named groups for answer options. |
| 1.4.1 Use of colour | Pass | Right / wrong: icon + word ("Correct!" ✓, "Not quite…" ✗; Passed / Not passed with ✓ / ✗); selected options: `aria-pressed` / `aria-checked` plus a check mark; the urgent timer keeps its number. |
| 1.4.3 Contrast (minimum) | Pass (axe, both modes) | New tokens `stage-muted` and `primary-ink`; no coloured text on tints; toasts ink on popover. Custom brand themes take their muted text and accent from the palette, which the API contrast-checks; an extreme custom accent can still produce a weak `primary-ink` (gap). |
| 1.4.4 Resize text / 1.4.10 Reflow | Pass (tested at 320 px and 200 %) | Phone, remote and join page at 320 px; host console and presenter view at 640×360. |
| 1.4.11 Non-text contrast | Pass for focus rings and inputs (`ring` / `input` tokens, 3:1); not measured for every chart mark beyond the token test. |
| 1.4.13 Content on hover or focus | Pass | No hover-only content on live surfaces (`title` attributes are hints, never the only label). |
| 2.1.1 Keyboard | Pass | Every control is a native button / input / link; grid and pin boards have arrow-key and Enter alternatives to dragging; scroll boxes that can overflow are focusable. |
| 2.1.2 No keyboard trap | Pass | Only modal dialogs trap focus, and Escape closes them. |
| 2.1.4 Character key shortcuts | Pass | Select-answer letter / number shortcuts work only while focus is in the option list; host slide keys (arrows, PageUp/Down, F) are not single printable characters except F (fullscreen), which ignores inputs. F is a gap only in theory (no way to turn it off). |
| 2.2.1 Timing adjustable | Exception: real-time event | Answer windows are part of a live session run by the presenter, who can pause, extend (+30 s) or close them; participants cannot. |
| 2.3.3 Animation from interactions (AAA, done anyway) | Pass | `prefers-reduced-motion` stops CSS animations and framer-motion moves on all live surfaces. |
| 2.4.3 Focus order | Pass | Focus moves to the new screen's heading on each slide, status and own-pace page; to the new answer state after submitting; back to the trigger when a dialog or the Q&A drawer closes. |
| 2.4.6 Headings and labels / 2.4.7 Focus visible | Pass | Global `:focus-visible` outline in the deck's `ring` token; headings that receive focus programmatically show no ring (not controls). |
| 2.4.11 Focus not obscured (minimum) | Not tested automatically | No sticky overlays on the phone; toasts sit at the top and do not take focus. |
| 2.5.3 Label in name | Pass | "+30 s" is named "+30 s, add 30 seconds" (was "Add 30 seconds"). |
| 2.5.8 Target size (minimum) | Pass, 44 px on phones | Tabs, Q&A sort and upvote, word-cloud chip remove, ranking moves, remote notes toggle raised to 44 px. Host-console header buttons are 32 px (desktop, ≥ 24 px). |
| 3.3.1 / 3.3.2 Error identification, labels | Pass | Inputs named (`aria-label` from the messages), errors as announced toasts; a too-short join code says why. |
| 4.1.2 Name, role, value | Pass | Icon-only buttons named; a submitting button keeps its name; the leaderboard overlay is a real dialog; the timer is `role="timer"` with a name; scales announce "4 of 5 (Disagree 1, Agree 5)". |
| 4.1.3 Status messages | Pass | `LiveAnnouncer` (polite / assertive) on the phone, `role="status"` for the stage's slide heading and phase, the remote's state and phase, toasts (sonner's live region). |

## Known gaps

- **No manual screen-reader pass.** The announcements and focus moves are asserted in the browser (live
  region text, `toBeFocused()`), not listened to with NVDA, JAWS, VoiceOver or TalkBack. The double read
  that a focused heading plus a polite "New slide, 2 of 5" could cause, and how iOS VoiceOver queues the
  result announcement, are unverified.
- **Builder, library, settings, analytics, session reports:** not audited and their strings not extracted
  (out of W4-A's priority order; the owner asked for them only if time remained). The participant's
  results page was scanned and fixed.
- **One moderate axe finding** remains: `region` on the presenter view's left column (see Results). The
  scans list every finding per scan in `findings.jsonl`.
- **Custom themes:** contrast is guaranteed for the built-in light and dark looks (token test); a brand
  kit's palette is checked by the API, but `primary-ink` is derived (accent mixed toward the text) and was
  not measured for every possible accent.
- **The host console on a phone-sized screen** is usable but not designed for it (header buttons 32 px);
  the presenter view and remote are the phone-sized host tools.
- **Locales:** W4-B (Spanish) was dropped by the owner on 2026-11-05. Every string of the live surfaces is
  in `frontend/messages/en/*.json`, so a locale is a folder of translated files plus one line each in
  `i18n/config.ts` and `i18n/messages.ts`; page titles are built on the server from the English files.
