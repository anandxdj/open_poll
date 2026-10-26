import { z } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../../../common/utils/ApiError';
import { assertCan, can } from '../../../common/tenancy/policy';
import type { Action } from '../../../common/tenancy/roles';
import { PollService } from '../../polls/polls.service';
import { ResponseService } from '../../responses/responses.service';
import { createPollSchema, updatePollSchema } from '../../polls/polls.schema';
import { assertQuestionsGradeable, checkAnswerIndices } from '../../polls/polls.grading';
import { frontendUrl, serialize, workspaceScope, type McpUserContext } from '../mcp.context';
import { defineTool } from './types';

// ---------------------------------------------------------------------------
// Input shapes
//
// These raw zod shapes are exported and handed straight to server.registerTool,
// so what an agent reads in tools/list is the same object enforced here. The
// previous design kept a second copy in mcp.server.ts "in step by hand", which
// is how pollType and the answer fields went missing from the advertised schema
// in the first place.
//
// The load-bearing detail: an assessment's correctOptionIndices is REQUIRED and
// non-empty at the shape level, so it lands in the emitted JSON Schema's
// "required" array. A prose .describe() hint does not — a model can read
// "required for TRIAL" and still omit the field, discovering the rule only when
// the call is rejected. Required-ness is what a client validates before sending.
// ---------------------------------------------------------------------------

const questionCore = {
  text: z.string().min(1).describe('Question text'),
  options: z.array(z.string().min(1)).min(2).describe('Answer options, at least 2'),
  isMandatory: z.boolean().optional().describe('Whether an answer is required (default true)'),
  type: z
    .enum(['single', 'multiple'])
    .optional()
    .describe('Answer mode (default "single"). Use "multiple" when more than one option may be picked.'),
};

const answerMetaFields = {
  explanation: z
    .string()
    .optional()
    .describe('Why the correct answer is correct. Shown to the respondent after they answer.'),
  points: z.number().min(1).optional().describe('Score weight for this question (default 1)'),
};

const indicesDescription =
  "0-based indices into this question's own options array that are correct. A \"single\" question takes exactly one index; use type \"multiple\" to accept several.";

export const pollQuestionShape = { ...questionCore };

export const assessmentQuestionShape = {
  ...questionCore,
  correctOptionIndices: z
    .array(z.number().int().min(0))
    .min(1)
    .describe(`REQUIRED. ${indicesDescription}`),
  ...answerMetaFields,
};

// edit_poll can target either kind of poll, so answers stay optional in the
// schema and are enforced at dispatch time against the STORED poll's type —
// something an input schema cannot know.
export const editQuestionShape = {
  ...questionCore,
  correctOptionIndices: z
    .array(z.number().int().min(0))
    .optional()
    .describe(`Required when editing an assessment's questions. ${indicesDescription}`),
  ...answerMetaFields,
};

// checkAnswerIndices (shared with the REST surface via polls.grading.ts) rejects
// out-of-range indices and multi-answer "single" questions at the schema level.
const pollQuestion = z.object(pollQuestionShape);
const assessmentQuestion = z.object(assessmentQuestionShape).superRefine(checkAnswerIndices);
const editQuestion = z.object(editQuestionShape).superRefine(checkAnswerIndices);

// Create-time defaults deliberately differ from the REST API, which requires
// expiresAt and creates drafts (isPublished false): an agent asked to "make a
// poll" is expected to hand back a link that already works. The descriptions say
// so because the agent cannot otherwise tell it is about to publish something.
const envelopeShape = {
  isAnonymous: z.boolean().optional().describe('Whether responses are anonymous (default true)'),
  expiresAt: z
    .string()
    .optional()
    .describe('ISO expiry datetime; must be in the future. Defaults to 30 days from now.'),
  isPublished: z
    .boolean()
    .optional()
    .describe(
      'Defaults to TRUE: it goes live immediately and anyone with the link can respond. Pass false to create an unpublished draft instead (the web app creates drafts by default; this tool does not).',
    ),
};

export const createPollInputShape = {
  title: z.string().min(3).describe('Poll title, at least 3 characters'),
  ...envelopeShape,
  questions: z.array(pollQuestion).min(1).describe('Poll questions, at least 1'),
};

export const createAssessmentInputShape = {
  title: z.string().min(3).describe('Assessment title, at least 3 characters'),
  passingScorePercentage: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Score percentage a respondent needs to pass (default 70)'),
  ...envelopeShape,
  questions: z
    .array(assessmentQuestion)
    .min(1)
    .describe('Assessment questions, at least 1. Every question must declare correctOptionIndices.'),
};

export const editPollInputShape = {
  pollId: z.string().min(1).describe('ID of the poll or assessment to update'),
  title: z.string().min(3).optional(),
  passingScorePercentage: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Assessments only: score percentage needed to pass'),
  ...envelopeShape,
  // Edits have no defaults; override the create-time wording spread in above.
  expiresAt: z.string().optional().describe('New ISO expiry datetime; must be in the future'),
  isPublished: z.boolean().optional().describe('true publishes (goes live), false unpublishes back to a draft'),
  questions: z
    .array(editQuestion)
    .min(1)
    .optional()
    .describe(
      'Replaces every stored question. When the target is an assessment, each question must carry correctOptionIndices or the call is rejected.',
    ),
};

export const convertPollToAssessmentInputShape = {
  pollId: z.string().min(1).describe('ID of the ungraded poll to convert'),
  passingScorePercentage: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Score percentage a respondent needs to pass (default 70)'),
  questions: z
    .array(assessmentQuestion)
    .min(1)
    .describe(
      'REQUIRED. The full replacement question set, each with correctOptionIndices. The stored questions were written as an ungraded poll and carry no correct answers, so they cannot be reused.',
    ),
};

const createPollMcpInputSchema = z.object(createPollInputShape);
const createAssessmentMcpInputSchema = z.object(createAssessmentInputShape);
const convertPollToAssessmentMcpInputSchema = z.object(convertPollToAssessmentInputShape);
const editPollMcpInputSchema = z.object(editPollInputShape).superRefine((data, ctx) => {
  if (Object.keys(data).length <= 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one field besides pollId is required',
    });
  }
});

function defaultExpiresAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString();
}

function parsePollId(raw: unknown): string {
  const pollId = z.string().min(1).parse(raw);
  if (!mongoose.isValidObjectId(pollId)) {
    throw ApiError.badRequest('Invalid poll ID');
  }
  return pollId;
}

async function assertPollAccess(pollId: string, ctx: McpUserContext, action: Action) {
  const poll = await PollService.getPollById(pollId);
  if (!can(await workspaceScope(ctx), action, poll)) {
    throw ApiError.forbidden('You do not have permission to access this poll');
  }
  return poll;
}

// A schema can guarantee answers are PRESENT; it cannot guarantee they are RIGHT.
// correctOptionIndices [1] when the answer sits at 0 is a perfectly valid payload.
// So every graded write echoes the answers back resolved to option text, letting
// the agent — and whoever reads its output — catch an off-by-one that no amount
// of validation would.
function describeGrading(poll: { questions?: unknown[] }) {
  const questions = ((poll.questions ?? []) as any[]).map((question) => {
    const indices: number[] = question.correctOptionIndices ?? [];
    return {
      text: question.text,
      correctAnswers: indices.map(
        (index) => question.options?.[index] ?? `<no option at index ${index}>`,
      ),
      points: question.points ?? 1,
    };
  });

  return {
    gradeable: questions.length > 0 && questions.every((q) => q.correctAnswers.length > 0),
    maxScore: questions.reduce((total, q) => total + q.points, 0),
    questions,
    note: 'correctAnswers are resolved from correctOptionIndices to the option text actually stored. Confirm each is the answer you intended — a valid index can still point at the wrong option.',
  };
}

// ---------------------------------------------------------------------------
// Tools: legacy async polls and graded assessments (`/p/:pollId`).
// ---------------------------------------------------------------------------

const pollIdShape = { pollId: z.string().describe('Poll ID') };

export const POLL_TOOLS = [
  defineTool({
    name: 'list_polls',
    scope: 'poll:read',
    description: 'List all polls and assessments created by the authenticated user.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    async handler(_args, ctx) {
      const scope = await workspaceScope(ctx);
      assertCan(scope, 'deck:read');
      const polls = await PollService.listPolls({ userId: ctx.userId, workspace: scope.workspace });
      return { polls: serialize(polls) };
    },
  }),

  defineTool({
    name: 'get_poll',
    scope: 'poll:read',
    description: 'Get a single poll or assessment by ID. Only ones you own are accessible.',
    inputShape: pollIdShape,
    annotations: { readOnlyHint: true, destructiveHint: false },
    async handler(args, ctx) {
      const pollId = parsePollId(args?.pollId);
      const poll = await assertPollAccess(pollId, ctx, 'deck:read');
      return { poll: serialize(poll) };
    },
  }),

  // The input shapes above are both advertised and enforced, so the schema an
  // agent reads and the schema validated here cannot drift apart.
  defineTool({
    name: 'create_poll',
    scope: 'poll:create',
    description:
      'Create an UNGRADED opinion poll — no correct answers, no scoring. For a quiz, test, exam, or anything scored, use create_assessment instead; this tool cannot express correct answers. The poll goes live immediately (published, open to anyone with the link) unless you pass isPublished: false — unlike the web app, which creates drafts. expiresAt defaults to 30 days from now. For a live session with a room (slides, word clouds, a join code), use create_deck instead.',
    inputShape: createPollInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const parsed = createPollMcpInputSchema.parse(args);

      // Spread rather than re-listing keys, so a field added to the shape above
      // cannot silently vanish here. pollType is pinned: this tool creates
      // ungraded polls only, and its schema has no answer fields to grade with.
      const validated = createPollSchema.parse({
        ...parsed,
        pollType: 'POLL',
        isAnonymous: parsed.isAnonymous ?? true,
        expiresAt: parsed.expiresAt ?? defaultExpiresAt(),
        isPublished: parsed.isPublished ?? true,
      });

      // No workspace argument: the poll lands in the token owner's default workspace.
      const poll = await PollService.createPoll(validated, ctx.userId);
      return { poll: serialize(poll) };
    },
  }),

  defineTool({
    name: 'create_assessment',
    scope: 'poll:create',
    description:
      'Create a GRADED assessment (a quiz, test, trial, or exam) that people take on their own through a link. Every question must declare correctOptionIndices — the schema requires it, so an assessment that could never be scored cannot be submitted. Optionally set passingScorePercentage (default 70), per-question points, and an explanation shown after answering. The assessment goes live immediately (published, open to anyone with the link) unless you pass isPublished: false — unlike the web app, which creates drafts. expiresAt defaults to 30 days from now. The response echoes a "grading" summary resolving your indices to option text: check it, because a valid index can still be the wrong answer.',
    inputShape: createAssessmentInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const parsed = createAssessmentMcpInputSchema.parse(args);

      const validated = createPollSchema.parse({
        ...parsed,
        pollType: 'TRIAL',
        isAnonymous: parsed.isAnonymous ?? true,
        expiresAt: parsed.expiresAt ?? defaultExpiresAt(),
        isPublished: parsed.isPublished ?? true,
      });

      const poll = await PollService.createPoll(validated, ctx.userId);
      return { poll: serialize(poll), grading: describeGrading(poll) };
    },
  }),

  defineTool({
    name: 'edit_poll',
    scope: 'poll:edit',
    description:
      'Update an owned poll or assessment. Supply at least one field besides pollId. Supplying questions replaces all stored questions; if the target is a graded assessment, every supplied question must carry correctOptionIndices or the call is rejected. To turn an ungraded poll into a graded assessment use convert_poll_to_assessment. Cannot edit closed polls. Cannot delete polls via MCP.',
    inputShape: editPollInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const parsed = editPollMcpInputSchema.parse(args);
      const { pollId: rawPollId, ...updates } = parsed;
      const pollId = parsePollId(rawPollId);
      const existing = await assertPollAccess(pollId, ctx, 'deck:edit');

      // The stored poll's type is only known after the fetch, so this cannot live in
      // the input schema. Stricter than PollService's own check, which only guards
      // PUBLISHED assessments: over MCP, an assessment always carries answers.
      if (existing.pollType === 'TRIAL' && updates.questions) {
        assertQuestionsGradeable(updates.questions);
      }

      const validated = updatePollSchema.parse(updates);

      const poll = await PollService.updatePoll(pollId, validated);
      return {
        poll: serialize(poll),
        ...(poll.pollType === 'TRIAL' ? { grading: describeGrading(poll) } : {}),
      };
    },
  }),

  defineTool({
    name: 'convert_poll_to_assessment',
    scope: 'poll:edit',
    description:
      'Turn an existing ungraded poll into a graded assessment. Requires the full replacement question set with correctOptionIndices on every question, because the stored questions were written as an ungraded poll and carry no correct answers. Converting an assessment back to an ungraded poll is not available via MCP.',
    inputShape: convertPollToAssessmentInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const parsed = convertPollToAssessmentMcpInputSchema.parse(args);
      const { pollId: rawPollId, ...updates } = parsed;
      const pollId = parsePollId(rawPollId);
      await assertPollAccess(pollId, ctx, 'deck:edit');

      const validated = updatePollSchema.parse({ ...updates, pollType: 'TRIAL' });

      const poll = await PollService.updatePoll(pollId, validated);
      return { poll: serialize(poll), grading: describeGrading(poll) };
    },
  }),

  defineTool({
    name: 'get_poll_analytics',
    scope: 'analytics:read',
    description: 'Get aggregate vote counts for a poll. No individual voter data.',
    inputShape: pollIdShape,
    annotations: { readOnlyHint: true, destructiveHint: false },
    async handler(args, ctx) {
      const pollId = parsePollId(args?.pollId);
      await assertPollAccess(pollId, ctx, 'session:read');
      const analytics = await ResponseService.getPollAnalytics(pollId);
      return {
        analytics,
        note: 'Aggregate vote counts only. Individual voter identities are not available via MCP.',
      };
    },
  }),

  defineTool({
    name: 'get_share_link',
    scope: 'poll:read',
    description: 'Get the public respondent URL for a poll (/p/:pollId on the Open Poll frontend).',
    inputShape: pollIdShape,
    annotations: { readOnlyHint: true, destructiveHint: false },
    async handler(args, ctx) {
      const pollId = parsePollId(args?.pollId);
      const poll = await assertPollAccess(pollId, ctx, 'deck:read');
      const shareUrl = `${frontendUrl()}/p/${pollId}`;

      return {
        pollId,
        shareUrl,
        isPublished: poll.isPublished,
        note: poll.isPublished
          ? 'Poll is live — respondents can use this link.'
          : 'Poll is still a draft — publish it before sharing with respondents.',
      };
    },
  }),
];
