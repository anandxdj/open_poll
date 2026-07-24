import { z } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import { ResponseService } from '../responses/responses.service';
import { createPollSchema, updatePollSchema } from '../polls/polls.schema';
import type { McpScope } from './mcp.constants';

// MCP tools only expose a subset of createPollSchema/updatePollSchema's fields
// (no pollType/passingScorePercentage/quiz question fields); the REST schemas'
// own zod .default()s fill in the rest so both surfaces stay in sync.
const mcpPollQuestionInput = z.object({
  text: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  isMandatory: z.boolean().optional(),
});

const createPollMcpInputSchema = z.object({
  title: z.string().min(3),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(mcpPollQuestionInput).min(1),
});

const editPollMcpInputSchema = z.object({
  pollId: z.string().min(1),
  title: z.string().min(3).optional(),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(mcpPollQuestionInput).min(1).optional(),
}).refine((data) => Object.keys(data).length > 1, {
  message: 'At least one field besides pollId is required',
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

      const validated = createPollSchema.parse({
        title: parsed.title,
        isAnonymous: parsed.isAnonymous ?? true,
        expiresAt: parsed.expiresAt ?? defaultExpiresAt(),
        isPublished: parsed.isPublished ?? true,
        questions: parsed.questions,
      });

      const poll = await PollService.createPoll(validated, ctx.userId);
      return { poll: serialize(poll) };
    }

    case 'edit_poll': {
      assertScope(ctx.scopes, 'poll:edit');
      const parsed = editPollMcpInputSchema.parse(args);
      await assertPollOwner(parsed.pollId, ctx.userId);

      const { pollId, ...updates } = parsed;
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
    'Open Poll MCP server — manage polls for the authenticated user.',
    `Public poll links: ${frontendUrl}/p/:pollId (use get_share_link).`,
    'Deletion and closing polls are not available via MCP; use the web app.',
    'get_poll_analytics returns aggregate counts only.',
  ].join(' ');
}
