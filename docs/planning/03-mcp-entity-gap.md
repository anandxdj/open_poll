# MCP Gap — "Create an assessment" Produces a Plain Poll

> Created 2026-07-30. Reported symptom: via an MCP client / AI agent, asking to create an
> assessment (quiz) creates an ordinary poll instead.
>
> **Status: fixed** on branch `fix/mcp-assessment-polltype`, then hardened past the
> original remediation. The schema widening described below shipped first; it was
> superseded by a **tool split** (`create_assessment` / `convert_poll_to_assessment`)
> because a widened single tool could still be called with the answers omitted — see
> "Superseded: why widening was not enough". Still open: the `quizzes` dead-module
> cleanup, the REST-surface validation hole, and the doc drift — all recorded below.

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
fallback (`ai.service.ts:43-46`) does the same.

**Correct for `pollType` only.** Revisited later: the *answers* had the same hole as MCP,
since `generatedPollSchema` defaults `correctOptionIndices` to `[]`. See "The AI path had
the same hole" below.

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

### Superseded: why widening was not enough

The widening above shipped and works, but it left the actual failure mode intact. An agent
does not read `.describe()` prose or discover a server-side `.superRefine` before calling —
it validates its payload against the emitted JSON Schema, where only `required` binds. With
one widened `create_poll`, `tools/list` advertised:

```
question required: ['text','options']
```

`correctOptionIndices` was optional. An agent could set `pollType: 'TRIAL'`, omit the
answers, and only learn the rule from a rejection — or, with the refinement absent, persist
an ungradeable assessment. Prose steers; `required` binds.

**Fix: split the tools**, so the graded contract lives where the client can see it.

| Tool | Scope | Emitted question `required` |
| --- | --- | --- |
| `create_poll` | `poll:create` | `['text','options']` — no answer fields exist at all |
| `create_assessment` | `poll:create` | `['text','options','correctOptionIndices']` |
| `convert_poll_to_assessment` | `poll:edit` | `['text','options','correctOptionIndices']` |
| `edit_poll` | `poll:edit` | answers optional — enforced post-fetch against stored `pollType` |

`create_poll` lost its `pollType` field entirely and pins `'POLL'`, so `TRIAL` cannot be
smuggled through the ungraded tool. A top-level `z.discriminatedUnion` on `pollType` was
rejected: it emits a top-level `anyOf`, and MCP/Anthropic `input_schema` must be
`type: "object"`. JSON Schema `if/then/required` is not expressible in zod and clients
enforce it inconsistently.

Three further changes came with the split:

- **Single source of truth.** `mcp.tools.ts` now exports the zod shapes that
  `mcp.server.ts` registers. The hand-kept mirror between the two files was the original
  bug's mechanism; it can no longer drift.
- **`edit_poll` regression closed.** Editing a poll already stored as `TRIAL` with
  answerless questions used to silently un-grade a live assessment. `assertQuestionsGradeable`
  now runs after the fetch, where the stored `pollType` is known.
- **Presence is not correctness.** No schema can tell `correctOptionIndices: [1]` from the
  answer actually being at `0`. Every graded write returns a `grading` block resolving each
  index to its stored option text, plus `gradeable` and `maxScore`; the server instructions
  tell agents to read it back before reporting success.

`MCP_TOOL_SCOPES` also went live (see "Other MCP issues" below) — `assertToolScope` reads
the map and fails closed on an unknown tool.

### The AI path had the same hole

`ai.service.ts` generated every draft against `generatedPollSchema`, whose
`correctOptionIndices` defaults to `[]`. The post-generation override set `pollType: 'TRIAL'`
correctly, so a Gemini-generated assessment could be labelled graded while carrying no
answers. Fixed in the same commit: `generatedTrialSchema` (`ai.schema.ts`) requires
`correctOptionIndices` with `.min(1)`, and `ai.service.ts` picks it for `isTrial` in both
`withStructuredOutput` and the final `.parse`.

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

- ~~**Advertised schema is looser than enforced schema.**~~ **Fixed.** `mcp.server.ts`
  published what clients see while `mcp.tools.ts` re-validated more strictly —
  `create_poll.title` advertised `z.string()` but enforced `.min(3)`, `questions`
  advertised without `.min(1)`, option strings likewise. Agents hit validation errors they
  had no way to predict from `tools/list`. The two files now share one exported shape.
- ~~**`edit_poll` skips ObjectId validation.**~~ **Fixed** — routed through `parsePollId`.
- ~~**`MCP_TOOL_SCOPES` is dead.**~~ **Fixed.** It was declared at `mcp.constants.ts:14-21`
  and imported nowhere while `dispatchMcpTool` hardcoded the scope at each `case`.
  `assertToolScope` now reads the map and throws on a tool missing from it.
- **MCP and REST disagree on `isPublished`.** `createPollSchema` defaults it to `false`
  (`polls.schema.ts:22`); `create_poll` overrides to `true` (`mcp.tools.ts:118`). MCP-created
  polls go live immediately, UI-created ones start as drafts. Intentional per the tool
  description, but undocumented in the README. Sharper now: an agent creating an assessment
  publishes it live by default.
- **Test coverage gaps.** Partly closed: `backend/tests/mcp.tools.test.ts` now covers all
  four write tools plus `get_share_link` and `list_polls`, and
  `backend/tests/mcp.publicUrl.test.ts` covers connector-URL resolution. The
  transport/session layer is still only exercised by the throwaway e2e probes in
  `backend/scratch/`.

## Verification

Unit: `bun test` — 59 pass. E2E over the real `/mcp` Streamable HTTP transport, against a
running backend (`backend/scratch/`, throwaway, not part of the app):

- `test_mcp_trial.ts` — 50 assertions. Section [1] reads the live `tools/list` output and
  asserts the `required` arrays directly, since that is the only thing binding an agent.
- `test_mcp_trial_grading.ts` — 13 assertions. A TRIAL built purely through MCP is graded
  correctly by the normal respondent path (scores, pass threshold, explanations, partial
  multi-select earning nothing).

The original fix was also negative-controlled: reverting to the pre-fix handler turned the
probe into 8 pass / 26 fail, reproducing `pollType: "POLL"` on a TRIAL request.

## Next steps

1. ~~Branch off for this work.~~ Done — `fix/mcp-assessment-polltype`.
2. ~~Decide whether the `TRIAL`-requires-correct-answers validation goes in the same
   commit.~~ It did, and then moved into the schema itself via the tool split.
3. ~~Ship the schema widening + description rewrite + test amendment together.~~ Shipped,
   then superseded by the tool split.
4. **Manual end-to-end test with a real MCP client** (Claude Desktop via `mcp-remote`) —
   the probes drive the transport directly, so no real agent has yet chosen a tool from
   these descriptions unaided. That is the remaining unknown.
5. Close the REST-surface hole (see "The REST hole remains open" above) — direct REST
   callers can still persist an ungradeable assessment.
6. Separately: `quizzes` module deletion, and the doc drift above.
