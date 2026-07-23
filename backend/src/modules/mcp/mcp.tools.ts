import { z } from 'zod';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import { ResponseService } from '../responses/responses.service';
import type { McpScope } from './mcp.constants';

const pollQuestionSchema = z.object({
  text: z.string().min(3),
  options: z.array(z.string().min(1)).min(2),
  isMandatory: z.boolean().optional(),
});

const createPollInputSchema = z.object({
  title: z.string().min(3),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(pollQuestionSchema).min(1),
});

const editPollInputSchema = z.object({
  pollId: z.string().min(1),
  title: z.string().min(3).optional(),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(pollQuestionSchema).min(1).optional(),
}).refine((data) => Object.keys(data).length > 1, {
  message: 'At least one field besides pollId is required',
});

export type McpUserContext = {
  userId: string;
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
  switch (name) {
    case 'list_polls': {
      assertScope(ctx.scopes, 'poll:read');
      const polls = await PollService.listPollsByCreator(ctx.userId);
      return { polls: serialize(polls) };
    }

    case 'get_poll': {
      assertScope(ctx.scopes, 'poll:read');
      const pollId = z.string().min(1).parse(args?.pollId);
      const poll = await assertPollOwner(pollId, ctx.userId);
      return { poll: serialize(poll) };
    }

    case 'create_poll': {
      assertScope(ctx.scopes, 'poll:create');
      const parsed = createPollInputSchema.parse(args);
      const expiresAt = parsed.expiresAt ?? defaultExpiresAt();
      if (new Date(expiresAt).getTime() <= Date.now()) {
        throw ApiError.badRequest('Expiry date must be in the future');
      }

      const poll = await PollService.createPoll(
        {
          title: parsed.title,
          pollType: 'POLL',
          passingScorePercentage: 70,
          isAnonymous: parsed.isAnonymous ?? true,
          expiresAt,
          isPublished: parsed.isPublished ?? true,
          questions: parsed.questions.map((question) => ({
            ...question,
            type: (question as any).type ?? 'single',
            correctOptionIndices: (question as any).correctOptionIndices ?? [],
            explanation: (question as any).explanation ?? '',
            points: (question as any).points ?? 1,
            isMandatory: question.isMandatory ?? true,
          })),
        },
        ctx.userId,
      );

      return { poll: serialize(poll) };
    }

    case 'edit_poll': {
      assertScope(ctx.scopes, 'poll:edit');
      const parsed = editPollInputSchema.parse(args);
      await assertPollOwner(parsed.pollId, ctx.userId);

      const { pollId, ...updates } = parsed;
      if (updates.expiresAt && new Date(updates.expiresAt).getTime() <= Date.now()) {
        throw ApiError.badRequest('Expiry date must be in the future');
      }

      const poll = await PollService.updatePoll(pollId, {
        ...updates,
        questions: updates.questions?.map((question) => ({
          ...question,
          type: (question as any).type ?? 'single',
          correctOptionIndices: (question as any).correctOptionIndices ?? [],
          explanation: (question as any).explanation ?? '',
          points: (question as any).points ?? 1,
          isMandatory: question.isMandatory ?? true,
        })),
      });
      return { poll: serialize(poll) };
    }

    case 'get_poll_analytics': {
      assertScope(ctx.scopes, 'analytics:read');
      const pollId = z.string().min(1).parse(args?.pollId);
      await assertPollOwner(pollId, ctx.userId);
      const analytics = await ResponseService.getPollAnalytics(pollId);
      return {
        analytics,
        note: 'Aggregate vote counts only. Individual voter identities are not available via MCP.',
      };
    }

    case 'get_share_link': {
      assertScope(ctx.scopes, 'poll:read');
      const pollId = z.string().min(1).parse(args?.pollId);
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
    'Open Poll MCP server — manage polls for the authenticated user.',
    `Public poll links: ${frontendUrl}/p/:pollId (use get_share_link).`,
    'Deletion and closing polls are not available via MCP; use the web app.',
    'get_poll_analytics returns aggregate counts only.',
  ].join(' ');
}
