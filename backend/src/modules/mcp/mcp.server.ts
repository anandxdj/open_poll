import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleMcpTool, getMcpServerInstructions } from './mcp.tools.js';
import type { McpScope } from './mcp.constants.js';

export type McpSessionContext = {
  userId: string;
  tokenId: string;
  scopes: McpScope[];
};

// Kept in step with mcpPollQuestionInput in mcp.tools.ts. What is advertised here
// must match what is enforced there, or agents hit validation errors they had no
// way to predict from tools/list.
const pollQuestionShape = z.object({
  text: z.string().min(1).describe('Question text'),
  options: z.array(z.string().min(1)).min(2).describe('Answer options, at least 2'),
  isMandatory: z.boolean().optional().describe('Whether an answer is required (default true)'),
  type: z
    .enum(['single', 'multiple'])
    .optional()
    .describe('Answer mode (default "single"). Use "multiple" when more than one option is correct.'),
  correctOptionIndices: z
    .array(z.number().int().min(0))
    .optional()
    .describe(
      'TRIAL only: 0-based indices into this question\'s options that are correct. Required for every question when pollType is "TRIAL". A "single" question accepts at most one.',
    ),
  explanation: z.string().optional().describe('TRIAL only: why the correct answer is correct, shown after answering'),
  points: z.number().min(1).optional().describe('TRIAL only: score weight for this question (default 1)'),
});

export function createMcpServer(ctx: McpSessionContext): McpServer {
  const server = new McpServer(
    {
      name: 'open-poll',
      version: '1.0.0',
    },
    {
      instructions: getMcpServerInstructions(),
    },
  );

  const runTool = async (name: string, args: Record<string, unknown> | undefined) => {
    try {
      const result = await handleMcpTool(name, args, {
        userId: ctx.userId,
        tokenId: ctx.tokenId,
        scopes: ctx.scopes,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      return {
        isError: true,
        content: [{ type: 'text' as const, text: message }],
      };
    }
  };

  server.registerTool(
    'list_polls',
    {
      description: 'List all polls created by the authenticated user.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => runTool('list_polls', {}),
  );

  server.registerTool(
    'get_poll',
    {
      description: 'Get a single poll by ID. Only polls you own are accessible.',
      inputSchema: {
        pollId: z.string().describe('Poll ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ pollId }) => runTool('get_poll', { pollId }),
  );

  server.registerTool(
    'create_poll',
    {
      description:
        'Create a poll or a graded assessment. Set pollType to "TRIAL" for an assessment (called a quiz or trial in the UI) — every question must then carry correctOptionIndices, or the call is rejected as ungradeable. Leave pollType unset or "POLL" for an ordinary ungraded poll. Defaults to published (live) unless isPublished is false. expiresAt defaults to 30 days from now.',
      inputSchema: {
        title: z.string().min(3).describe('Poll title, at least 3 characters'),
        pollType: z
          .enum(['POLL', 'TRIAL'])
          .optional()
          .describe('"POLL" = ungraded opinion poll (default). "TRIAL" = graded assessment with correct answers.'),
        passingScorePercentage: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('TRIAL only: score percentage needed to pass (default 70)'),
        isAnonymous: z.boolean().optional().describe('Whether responses are anonymous (default true)'),
        expiresAt: z.string().optional().describe('ISO expiry datetime; must be in the future. Defaults to 30 days from now.'),
        isPublished: z.boolean().optional().describe('Whether the poll is live (default true)'),
        questions: z.array(pollQuestionShape).min(1).describe('Poll questions, at least 1'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => runTool('create_poll', args as Record<string, unknown>),
  );

  server.registerTool(
    'edit_poll',
    {
      description:
        'Update an owned poll. Supply at least one field besides pollId. Converting a poll to a graded assessment (pollType "TRIAL") also requires resupplying questions with correctOptionIndices, since the stored questions have no correct answers. Cannot edit closed polls. Cannot delete polls via MCP.',
      inputSchema: {
        pollId: z.string().describe('Poll ID to update'),
        title: z.string().min(3).optional(),
        pollType: z
          .enum(['POLL', 'TRIAL'])
          .optional()
          .describe('Switch between ungraded poll and graded assessment. "TRIAL" requires resupplying questions.'),
        passingScorePercentage: z.number().min(0).max(100).optional().describe('TRIAL only: pass mark percentage'),
        isAnonymous: z.boolean().optional(),
        expiresAt: z.string().optional().describe('ISO expiry datetime; must be in the future'),
        isPublished: z.boolean().optional(),
        questions: z.array(pollQuestionShape).min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => runTool('edit_poll', args as Record<string, unknown>),
  );

  server.registerTool(
    'get_poll_analytics',
    {
      description: 'Get aggregate vote counts for a poll. No individual voter data.',
      inputSchema: {
        pollId: z.string().describe('Poll ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ pollId }) => runTool('get_poll_analytics', { pollId }),
  );

  server.registerTool(
    'get_share_link',
    {
      description: 'Get the public respondent URL for a poll (/p/:pollId on the Open Poll frontend).',
      inputSchema: {
        pollId: z.string().describe('Poll ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ pollId }) => runTool('get_share_link', { pollId }),
  );

  return server;
}
