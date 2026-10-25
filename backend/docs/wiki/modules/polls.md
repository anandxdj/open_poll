---
summary: Poll module responsibilities, lifecycle states, graded assessments (TRIAL), and key rules.
status: active
last_updated: 2026-10-19
---

# Polls Module

`modules/polls` manages poll definition and lifecycle, for both ungraded polls and
graded assessments.

## Workspace tenancy

Every poll belongs to a workspace (`workspaceId`, set on create from the caller's workspace;
backfilled by migration 020). Authenticated routes run `workspaceContext()` and authorize with
`assertCan` (`deck:create|read|edit|delete|host`, `session:share|read`); the public read and the
voting paths stay open. Route-by-route table, the unmigrated-poll fallback and MCP behaviour:
`modules/workspaces.md` → "Poll tenancy".

## Lifecycle State
- `isPublished`: controls whether respondents can submit. REST creates drafts by default
  (`false`); MCP's create tools default to `true` (see `src/modules/mcp/README.md`).
- `isClosed`: terminal state set by close endpoint.
- `expiresAt`: time-based closure guard.

## Guarantees
- Every question has at least 2 options and is `single` (default) or `multiple` choice.
- Poll must contain at least one question.
- Closed polls cannot be updated.
- A published assessment is always gradeable (below).

## Assessments (`pollType: 'TRIAL'`)

A poll is either `POLL` (ungraded opinion poll, the default) or `TRIAL` — a graded
assessment, labelled "Assessment" / "Quiz" in the UI. This is unrelated to the
slide-based live decks in `modules/presentations`.

Assessment fields:
- `passingScorePercentage` (poll, 0–100, default 70) — pass mark for an attempt.
- `correctOptionIndices` (question, default `[]`) — 0-based indices into that question's
  `options` that are correct. A `single` question has at most one; `multiple` may have several.
- `points` (question, ≥ 1, default 1) — score weight.
- `explanation` (question, default `''`) — why the answer is right, shown after answering.

Grading (`ResponseService.submitResponse`): a question scores its `points` only when the
respondent's selected indices exactly equal `correctOptionIndices` (no partial credit on
`multiple`). `percentage = round(score / maxScore * 100)`, `passed = percentage >= passingScorePercentage`.
The breakdown with correct answers and explanations is returned only on a pass. Only
`POLL`s have per-device duplicate-vote blocking; a `TRIAL` accepts repeat attempts and
records each one's `attemptNumber`, score and pass/fail on the response.

### Gradeability rule

`polls.grading.ts` defines it once, shared by REST, `PollService` and the MCP tools:
every question has a non-empty `correctOptionIndices`, every index is in range of its
`options`, and a `single` question has at most one. Without it an assessment silently
breaks: with `[]` stored, skipping a question grades as correct; with an out-of-range
index, nobody can ever score it.

Where it is enforced:
- `POST /api/polls` validates with `createPollRequestSchema` — `createPollSchema` plus a
  `superRefine`, reported per field (`questions.N.correctOptionIndices`). It is a
  separate schema because `ai.schema.ts` calls `createPollSchema.pick()`, which zod
  refuses on a refined object.
- `PollService.createPoll` repeats the check for any caller that skips the route.
- `PollService.updatePoll` checks the poll as it will be **after** the update, using the
  stored `pollType` / `isPublished` / `questions` for fields the payload omits — so
  `{ isPublished: true }` or `{ pollType: 'TRIAL' }` alone cannot put an answerless
  assessment live. Updates that touch none of those fields are not re-checked.

Only **published** assessments are held to the rule: the web builder autosaves `TRIAL`
drafts before any answer is marked, and respondents can only reach published polls.
The MCP tools are stricter and require answers on every assessment write.

AI generation (`modules/ai`) creates assessments against `generatedTrialSchema`, which
also requires `correctOptionIndices`, and always saves them as drafts.
