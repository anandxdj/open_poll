# MCP Gap — "Create an assessment" Produces a Plain Poll

> Created 2026-07-30. Reported symptom: via an MCP client / AI agent, asking to create an
> assessment (quiz) creates an ordinary poll instead.
>
> **Status: fixed** on branch `fix/mcp-assessment-polltype`. The remediation described
> below shipped, plus the in-range/single-answer validation and the `edit_poll` ObjectId
> check. Still open: the `quizzes` dead-module cleanup, the REST-surface validation hole,
> and the doc drift — all recorded below.

## Verdict

**Confirmed, single root cause.** The MCP `create_poll` handler strips `pollType` before
validating, so `createPollSchema`'s `.default('POLL')` fires on every call. An MCP client
cannot create an assessment, cannot supply correct answers, and cannot convert a poll into
an assessment afterwards. The tool reports success, so the agent believes it worked.

The web UI and the AI-generation path both handle assessments correctly. MCP is the only
broken surface.

## Terminology

"Assessment" / "Assessment Trial" is the UI label for `pollType: 'TRIAL'` on the poll
model — a graded poll with correct answers, per-question points, explanations, and a
`passingScorePercentage`. See `frontend/features/polls/components/CreatePollModal.tsx:129`
and `frontend/app/p/[id]/page.tsx:188`.

This is a different thing from the slide-based `quizzes`/`presentations` deck. See
"Secondary finding" below — that is a separate issue and not the reported bug.

## Root cause

`backend/src/modules/mcp/mcp.tools.ts:110-124` constructs an explicit five-key object
before validating, dropping every assessment-bearing field:

```ts
const validated = createPollSchema.parse({
  title: parsed.title,
  isAnonymous: parsed.isAnonymous ?? true,
  expiresAt: parsed.expiresAt ?? defaultExpiresAt(),
  isPublished: parsed.isPublished ?? true,
  questions: parsed.questions,
});
```

The MCP input schema never accepts them in the first place
(`mcp.tools.ts:12-24`) — `mcpPollQuestionInput` allows only `text`, `options`,
`isMandatory`. So `createPollSchema`'s defaults (`backend/src/modules/polls/polls.schema.ts:3-16`)
fill in:

| Field | Forced value | Consequence |
| --- | --- | --- |
| `pollType` | `'POLL'` | **the reported bug — never `'TRIAL'`** |
| `passingScorePercentage` | `70` | no pass mark control |
| question `type` | `'single'` | no multi-select questions |
| `correctOptionIndices` | `[]` | **no correct answers — ungradeable** |
| `points` | `1` | no per-question weighting |
| `explanation` | `''` | no post-answer teaching text |

Even if `pollType: 'TRIAL'` were passed through alone, the result would still be broken:
with `correctOptionIndices: []` on every question there is nothing to grade against. Note
`createPollSchema` does **not** enforce that a `TRIAL` has correct answers — only the
frontend does (`PollBuilder.tsx:332-334`). So a half-fix here produces a silently
ungradeable assessment.

`edit_poll` has the same hole from the other direction. `updatePollSchema` accepts
`pollType` (`polls.schema.ts:29`) and `PollService.updatePoll` assigns it
(`polls.service.ts:46`), but `editPollMcpInputSchema` (`mcp.tools.ts:26-35`) has no
`pollType` key, so the destructured `...updates` never carries one.

This behaviour is deliberate and load-bearing in the test suite. `mcp.tools.ts:9-11`:

```js
// MCP tools only expose a subset of createPollSchema/updatePollSchema's fields
// (no pollType/passingScorePercentage/quiz question fields); the REST schemas'
// own zod .default()s fill in the rest so both surfaces stay in sync.
```

`backend/tests/mcp.tools.test.ts:74-97` asserts it:

```ts
expect(createdPayload.pollType).toBe('POLL');
expect(createdPayload.passingScorePercentage).toBe(70);
expect(createdPayload.questions[0].type).toBe('single');
expect(createdPayload.questions[0].correctOptionIndices).toEqual([]);
```

**That test must be amended as part of the fix**, not deleted — it should assert defaults
apply when the fields are *omitted*, and that supplied values are honoured.

### Nothing tells the agent assessments exist

No MCP tool description contains the word "quiz", "trial", or "assessment"
(`mcp.server.ts:47-136`). The server instruction string (`mcp.tools.ts:171-179`) advertises
poll management only. Grep for `quiz|Quiz|TRIAL|pollType` across
`backend/src/modules/mcp/` returns zero hits in any `.ts` file. So the agent has no way to
know an assessment is a thing it could ask for — a schema fix alone is insufficient
without description text.

## Paths verified working (not the bug)

**Web UI.** `CreatePollModal.tsx:39` puts `pollType` in the URL query;
`PollBuilder.tsx:57` reads it; `PollBuilder.tsx:482` sends it. Correct end to end.

**AI generation.** `ai.service.ts:146` overrides the model's own output with the caller's
value after generation:

```ts
pollType: input.pollType || 'POLL',
passingScorePercentage: input.passingScorePercentage || 70,
```

The `isTrial` prompt branch (`ai.service.ts:115-133`) asks the LLM to set `pollType`
itself, and `generatedPollSchema` would default it to `'POLL'` if the LLM omitted it
(`ai.schema.ts:23`) — but the post-generation override at :146 makes that moot. The mock
fallback (`ai.service.ts:43-46`) does the same. Correct.

## Remediation

### The fix — widen the MCP poll schemas

1. `mcpPollQuestionInput` (`mcp.tools.ts:12-16`) — add `type`, `correctOptionIndices`,
   `points`, `explanation`, all optional.
2. `createPollMcpInputSchema` (`mcp.tools.ts:18-24`) — add `pollType`,
   `passingScorePercentage`, both optional.
3. `create_poll` handler (`mcp.tools.ts:110-124`) — pass the new fields through instead of
   dropping them. Prefer spreading the parsed object over re-listing keys, so the next
   field added to the poll schema does not silently vanish again.
4. `editPollMcpInputSchema` (`mcp.tools.ts:26-35`) — same additions, so an agent can
   promote an existing poll to an assessment.
5. `mcp.server.ts:68-116` — mirror the additions in the advertised schema, and rewrite the
   `create_poll` / `edit_poll` descriptions to state that `pollType: 'TRIAL'` creates a
   graded assessment and that `correctOptionIndices` is required for it to be gradeable.
6. `getMcpServerInstructions()` (`mcp.tools.ts:171-179`) — mention assessments.
7. Amend `backend/tests/mcp.tools.test.ts:74-97` as described above; add a case that
   creates a `TRIAL` with correct answers and asserts they survive.
8. Update the tool table in `backend/src/modules/mcp/README.md:30-42`.

**The REST hole remains open.** The obvious fix — a `.superRefine` on `createPollSchema`
requiring every `TRIAL` question to have correct answers — **cannot be applied there**:
`ai.schema.ts:20` does `createPollSchema.pick({ title: true, questions: true })`, and
`.superRefine` returns a `ZodEffects`, which has no `.pick()`. Adding it would break the AI
module at import time.

So the validation was implemented in the MCP input schema instead (scoped, no blast
radius). The frontend enforces it too (`PollBuilder.tsx:332-334`). **Direct REST callers
can still persist an ungradeable assessment.** Closing that properly needs either a
separate refined schema applied at the route's validate middleware, or restructuring
`ai.schema.ts` to stop picking off `createPollSchema`. Tracked as follow-up, not done here.

No new scopes, no token migration, no new routes. `poll:create` and `poll:edit` already
cover it.

### Scope check — what this fix does *not* do

It does not let an agent create a slide-based deck (`wordcloud`, `ranking`, `scales`,
live join code, leaderboard). That is the `presentations` entity and would need its own
tools and scopes. Out of scope here unless you want it; see below.

## Secondary finding — the `quizzes` module is dead code

Unrelated to the reported bug, but found during the investigation and worth recording.

`backend/src/app.ts:94`:

```ts
app.use('/api/quizzes', presentationsRouter);
```

`quizzesRouter` is never imported in `app.ts`. `QuizModel`, `QuizService`, and
`QuizController` are unreachable. The frontend's `POST /quizzes`
(`frontend/features/quizzes/api/quizApi.ts:22-23`) is validated by
`createPresentationSchema` and written to the `presentations` collection.

Only `QUIZ_SLIDE_TYPES` and `quizSlideSchema` survive, still imported by
`ai.schema.ts:3`. `presentations.schema.ts` is a byte-for-byte clone of
`quizzes.schema.ts` with names swapped, so the two can drift silently.

Cleanup (separate commit): delete `backend/src/modules/quizzes/`, relocate the two
surviving exports into the presentations module, update `ai.schema.ts:3`, and rewrite
`backend/docs/wiki/modules/quizzes.md` as `presentations.md`.

## Doc drift found

- `docs/planning/01-competitive-roadmap.md:26` lists the unified Presentation as `❌` not
  built. `backend/src/modules/presentations/` exists and is live.
- `presentations` has **no page** under `backend/docs/wiki/modules/` (only `ai.md`,
  `polls.md`, `quizzes.md`, `responses.md`). The module that *is* documented is the
  unmounted one.
- `pollType`, `TRIAL`, and `passingScorePercentage` appear in **no** markdown file in the
  repo. The assessment feature is entirely undocumented despite shipping in the UI and the
  AI module.

## Other MCP issues found while investigating

Independent of the assessment gap:

- **Advertised schema is looser than enforced schema.** `mcp.server.ts` publishes what
  clients see; `mcp.tools.ts` re-validates more strictly. `create_poll.title` is advertised
  as `z.string()` but enforced `.min(3)`; `questions` is advertised without `.min(1)` but
  enforced `.min(1)`; option strings likewise. Agents hit validation errors they had no way
  to predict from `tools/list`. Worth fixing in the same pass, since this fix touches both
  files anyway.
- **`edit_poll` skips ObjectId validation.** It passes `parsed.pollId` straight to
  `assertPollOwner` without the `mongoose.isValidObjectId` check the read tools get via
  `parsePollId` (`mcp.tools.ts:53-59`).
- **`MCP_TOOL_SCOPES` is dead.** Declared at `mcp.constants.ts:14-21`, imported nowhere;
  `dispatchMcpTool` hardcodes the scope string at each `case`. The map and the switch can
  drift.
- **MCP and REST disagree on `isPublished`.** `createPollSchema` defaults it to `false`
  (`polls.schema.ts:22`); `create_poll` overrides to `true` (`mcp.tools.ts:118`). MCP-created
  polls go live immediately, UI-created ones start as drafts. Intentional per the tool
  description, but undocumented in the README. Sharper now: an agent creating an assessment
  publishes it live by default.
- **Test coverage gaps.** No test for `edit_poll`, `get_share_link`, `list_polls` happy
  path, or the transport/session layer.

## Next steps

1. Branch off `security/hardening-p0-p1` for this work — that branch carries ~35 files of
   uncommitted changes that should not be entangled with it.
2. Decide whether the `TRIAL`-requires-correct-answers validation goes in the same commit.
3. Ship the schema widening + description rewrite + test amendment together; a schema-only
   change leaves the agent unaware the capability exists.
4. Separately: `quizzes` module deletion, and the doc drift above.
