import { z } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { assertCan, can } from '../../common/tenancy/policy';
import type { Action } from '../../common/tenancy/roles';
import { resolveWorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { PollService } from '../polls/polls.service';
import { ResponseService } from '../responses/responses.service';
import { createPollSchema, updatePollSchema } from '../polls/polls.schema';
import { assertQuestionsGradeable, checkAnswerIndices } from '../polls/polls.grading';
import { MCP_TOOL_SCOPES, type McpScope } from './mcp.constants';

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

export type McpUserContext = {
  userId: string;
  tokenId: string;
  scopes: McpScope[];
};

function serialize(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

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

/**
 * MCP requests carry no X-Workspace-Id: a token acts in its owner's default
 * workspace (the one last switched to in the app), provisioned on first use.
 */
async function workspaceScope(ctx: McpUserContext) {
  const { workspace, membership } = await resolveWorkspaceContext(ctx.userId);
  return { user: { id: ctx.userId }, workspace, membership };
}

async function assertPollAccess(pollId: string, ctx: McpUserContext, action: Action) {
  const poll = await PollService.getPollById(pollId);
  if (!can(await workspaceScope(ctx), action, poll)) {
    throw ApiError.forbidden('You do not have permission to access this poll');
  }
  return poll;
}

// Driven off MCP_TOOL_SCOPES so the map cannot drift from what is enforced. It
// used to be dead code while each case hardcoded its own scope string.
function assertToolScope(name: string, scopes: McpScope[]) {
  const required = MCP_TOOL_SCOPES[name];
  if (!required) {
    throw ApiError.notFound(`Unknown MCP tool: ${name}`);
  }
  if (!scopes.includes(required)) {
    throw ApiError.forbidden(`Missing required scope: ${required}`);
  }
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

export async function handleMcpTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: McpUserContext,
) {
  try {
    const result = await dispatchMcpTool(name, args, ctx);
    console.log(`[McpAudit] tool=${name} tokenId=${ctx.tokenId} userId=${ctx.userId} ok`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed';
    console.log(`[McpAudit] tool=${name} tokenId=${ctx.tokenId} userId=${ctx.userId} error="${message}"`);
    throw error;
  }
}

async function dispatchMcpTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: McpUserContext,
) {
  assertToolScope(name, ctx.scopes);

  switch (name) {
    case 'list_polls': {
      const scope = await workspaceScope(ctx);
      assertCan(scope, 'deck:read');
      const polls = await PollService.listPolls({ userId: ctx.userId, workspace: scope.workspace });
      return { polls: serialize(polls) };
    }

    case 'get_poll': {
      const pollId = parsePollId(args?.pollId);
      const poll = await assertPollAccess(pollId, ctx, 'deck:read');
      return { poll: serialize(poll) };
    }

    case 'create_poll': {
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
    }

    case 'create_assessment': {
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
    }

    case 'edit_poll': {
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
    }

    case 'convert_poll_to_assessment': {
      const parsed = convertPollToAssessmentMcpInputSchema.parse(args);
      const { pollId: rawPollId, ...updates } = parsed;
      const pollId = parsePollId(rawPollId);
      await assertPollAccess(pollId, ctx, 'deck:edit');

      const validated = updatePollSchema.parse({ ...updates, pollType: 'TRIAL' });

      const poll = await PollService.updatePoll(pollId, validated);
      return { poll: serialize(poll), grading: describeGrading(poll) };
    }

    case 'get_poll_analytics': {
      const pollId = parsePollId(args?.pollId);
      await assertPollAccess(pollId, ctx, 'session:read');
      const analytics = await ResponseService.getPollAnalytics(pollId);
      return {
        analytics,
        note: 'Aggregate vote counts only. Individual voter identities are not available via MCP.',
      };
    }

    case 'get_share_link': {
      const pollId = parsePollId(args?.pollId);
      const poll = await assertPollAccess(pollId, ctx, 'deck:read');
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      const shareUrl = `${frontendUrl}/p/${pollId}`;

      return {
        pollId,
        shareUrl,
        isPublished: poll.isPublished,
        note: poll.isPublished
          ? 'Poll is live — respondents can use this link.'
          : 'Poll is still a draft — publish it before sharing with respondents.',
      };
    }

    default:
      throw ApiError.notFound(`Unknown MCP tool: ${name}`);
  }
}

export function getMcpServerInstructions(): string {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return [
    'Open Poll MCP server — manage polls and graded assessments for the authenticated user.',
    'Two different tools create things: create_poll makes an ungraded opinion poll; create_assessment makes a graded assessment (called a quiz or trial in the UI) where every question declares its correct answers.',
    'Pick create_assessment whenever the user wants a quiz, test, exam, or anything scored. An assessment cannot be built with create_poll, which has no answer fields at all.',
    'Use convert_poll_to_assessment to turn an existing ungraded poll into a graded one; it needs the full replacement question set with correct answers.',
    'create_poll and create_assessment publish immediately by default, so respondents can use the link straight away; pass isPublished: false when the user wants a draft to review first.',
    'Graded writes echo back a "grading" summary resolving each correctOptionIndices to the option text stored. Read it and confirm the answers are the intended ones before reporting success.',
    `Public respondent links: ${frontendUrl}/p/:pollId (use get_share_link).`,
    'Deleting polls, closing polls, and converting an assessment back to an ungraded poll are not available via MCP; use the web app.',
    'get_poll_analytics returns aggregate counts only.',
  ].join(' ');
}
