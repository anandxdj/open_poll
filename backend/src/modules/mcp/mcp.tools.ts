import { z } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import { ResponseService } from '../responses/responses.service';
import { createPollSchema, updatePollSchema } from '../polls/polls.schema';
import type { McpScope } from './mcp.constants';

// MCP mirrors createPollSchema/updatePollSchema field-for-field, but keeps every
// optional field genuinely optional so the REST schemas' own zod .default()s fill
// in the rest and both surfaces stay in sync.
const mcpPollQuestionInput = z.object({
  text: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  isMandatory: z.boolean().optional(),
  type: z.enum(['single', 'multiple']).optional(),
  correctOptionIndices: z.array(z.number().int().min(0)).optional(),
  explanation: z.string().optional(),
  points: z.number().min(1).optional(),
}).superRefine((question, ctx) => {
  // polls.schema.ts only bounds indices below; an out-of-range index would persist
  // and silently mark a question ungradeable.
  for (const index of question.correctOptionIndices ?? []) {
    if (index >= question.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correctOptionIndices'],
        message: `correctOptionIndices contains ${index}, but this question only has ${question.options.length} options (valid range 0-${question.options.length - 1})`,
      });
    }
  }

  if (question.type === 'single' && (question.correctOptionIndices?.length ?? 0) > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['correctOptionIndices'],
      message: 'A "single" question can have at most one correct option; use type "multiple" instead',
    });
  }
});

type McpPollQuestionInput = z.infer<typeof mcpPollQuestionInput>;

// A TRIAL is only gradeable if every question declares its correct answers.
// createPollSchema does not enforce this (only the web builder does), so MCP
// enforces it here rather than persisting an assessment that can never be scored.
function assertTrialQuestionsAreGradeable(
  questions: McpPollQuestionInput[],
  ctx: z.RefinementCtx,
) {
  questions.forEach((question, index) => {
    if (!question.correctOptionIndices?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions', index, 'correctOptionIndices'],
        message: 'Every question in a TRIAL assessment needs at least one correct option index',
      });
    }
  });
}

const createPollMcpInputSchema = z.object({
  title: z.string().min(3),
  pollType: z.enum(['POLL', 'TRIAL']).optional(),
  passingScorePercentage: z.number().min(0).max(100).optional(),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(mcpPollQuestionInput).min(1),
}).superRefine((data, ctx) => {
  if (data.pollType === 'TRIAL') {
    assertTrialQuestionsAreGradeable(data.questions, ctx);
  }
});

const editPollMcpInputSchema = z.object({
  pollId: z.string().min(1),
  title: z.string().min(3).optional(),
  pollType: z.enum(['POLL', 'TRIAL']).optional(),
  passingScorePercentage: z.number().min(0).max(100).optional(),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(mcpPollQuestionInput).min(1).optional(),
}).superRefine((data, ctx) => {
  if (Object.keys(data).length <= 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one field besides pollId is required',
    });
  }

  if (data.pollType !== 'TRIAL') return;

  // Promoting a poll to a TRIAL requires resupplying the questions: the stored
  // ones were written as a plain POLL and carry no correct answers.
  if (!data.questions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['questions'],
      message: 'Converting a poll to a TRIAL assessment requires resupplying questions with correctOptionIndices',
    });
    return;
  }

  assertTrialQuestionsAreGradeable(data.questions, ctx);
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

async function assertPollOwner(pollId: string, userId: string) {
  const poll = await PollService.getPollById(pollId);
  if (String(poll.creatorId) !== userId) {
    throw ApiError.forbidden('You do not have permission to access this poll');
  }
  return poll;
}

function assertScope(scopes: McpScope[], required: McpScope) {
  if (!scopes.includes(required)) {
    throw ApiError.forbidden(`Missing required scope: ${required}`);
  }
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
  switch (name) {
    case 'list_polls': {
      assertScope(ctx.scopes, 'poll:read');
      const polls = await PollService.listPollsByCreator(ctx.userId);
      return { polls: serialize(polls) };
    }

    case 'get_poll': {
      assertScope(ctx.scopes, 'poll:read');
      const pollId = parsePollId(args?.pollId);
      const poll = await assertPollOwner(pollId, ctx.userId);
      return { poll: serialize(poll) };
    }

    case 'create_poll': {
      assertScope(ctx.scopes, 'poll:create');
      const parsed = createPollMcpInputSchema.parse(args);

      // Spread rather than re-listing keys, so a field added to the poll schema
      // and mirrored above does not silently get dropped here. Undefined optionals
      // fall through to createPollSchema's own .default()s.
      const validated = createPollSchema.parse({
        ...parsed,
        isAnonymous: parsed.isAnonymous ?? true,
        expiresAt: parsed.expiresAt ?? defaultExpiresAt(),
        isPublished: parsed.isPublished ?? true,
      });

      const poll = await PollService.createPoll(validated, ctx.userId);
      return { poll: serialize(poll) };
    }

    case 'edit_poll': {
      assertScope(ctx.scopes, 'poll:edit');
      const parsed = editPollMcpInputSchema.parse(args);
      const { pollId: rawPollId, ...updates } = parsed;
      const pollId = parsePollId(rawPollId);
      await assertPollOwner(pollId, ctx.userId);

      const validated = updatePollSchema.parse(updates);

      const poll = await PollService.updatePoll(pollId, validated);
      return { poll: serialize(poll) };
    }

    case 'get_poll_analytics': {
      assertScope(ctx.scopes, 'analytics:read');
      const pollId = parsePollId(args?.pollId);
      await assertPollOwner(pollId, ctx.userId);
      const analytics = await ResponseService.getPollAnalytics(pollId);
      return {
        analytics,
        note: 'Aggregate vote counts only. Individual voter identities are not available via MCP.',
      };
    }

    case 'get_share_link': {
      assertScope(ctx.scopes, 'poll:read');
      const pollId = parsePollId(args?.pollId);
      const poll = await assertPollOwner(pollId, ctx.userId);
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
    'Open Poll MCP server — manage polls and assessments for the authenticated user.',
    'Two poll types exist: pollType "POLL" is an ungraded opinion poll; pollType "TRIAL" is a graded assessment (also called a quiz or trial in the UI).',
    'To create an assessment, call create_poll with pollType "TRIAL" and give every question a correctOptionIndices array — a TRIAL without correct answers is rejected because it could never be scored.',
    `Public poll links: ${frontendUrl}/p/:pollId (use get_share_link).`,
    'Deletion and closing polls are not available via MCP; use the web app.',
    'get_poll_analytics returns aggregate counts only.',
  ].join(' ');
}
