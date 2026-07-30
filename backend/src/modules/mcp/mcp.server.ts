import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  handleMcpTool,
  getMcpServerInstructions,
  createPollInputShape,
  createAssessmentInputShape,
  editPollInputShape,
  convertPollToAssessmentInputShape,
} from './mcp.tools.js';
import type { McpScope } from './mcp.constants.js';

export type McpSessionContext = {
  userId: string;
  tokenId: string;
  scopes: McpScope[];
};

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
      description: 'List all polls and assessments created by the authenticated user.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => runTool('list_polls', {}),
  );

  server.registerTool(
    'get_poll',
    {
      description: 'Get a single poll or assessment by ID. Only ones you own are accessible.',
      inputSchema: {
        pollId: z.string().describe('Poll ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ pollId }) => runTool('get_poll', { pollId }),
  );

  // The input shapes come from mcp.tools.ts, which also enforces them, so the
  // advertised schema and the validated schema cannot drift apart.
  server.registerTool(
    'create_poll',
    {
      description:
        'Create an UNGRADED opinion poll — no correct answers, no scoring. For a quiz, test, exam, or anything scored, use create_assessment instead; this tool cannot express correct answers. Defaults to published (live) unless isPublished is false. expiresAt defaults to 30 days from now.',
      inputSchema: createPollInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => runTool('create_poll', args as Record<string, unknown>),
  );

  server.registerTool(
    'create_assessment',
    {
      description:
        'Create a GRADED assessment (a quiz, test, trial, or exam). Every question must declare correctOptionIndices — the schema requires it, so an assessment that could never be scored cannot be submitted. Optionally set passingScorePercentage (default 70), per-question points, and an explanation shown after answering. The response echoes a "grading" summary resolving your indices to option text: check it, because a valid index can still be the wrong answer.',
      inputSchema: createAssessmentInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => runTool('create_assessment', args as Record<string, unknown>),
  );

  server.registerTool(
    'edit_poll',
    {
      description:
        'Update an owned poll or assessment. Supply at least one field besides pollId. Supplying questions replaces all stored questions; if the target is a graded assessment, every supplied question must carry correctOptionIndices or the call is rejected. To turn an ungraded poll into a graded assessment use convert_poll_to_assessment. Cannot edit closed polls. Cannot delete polls via MCP.',
      inputSchema: editPollInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => runTool('edit_poll', args as Record<string, unknown>),
  );

  server.registerTool(
    'convert_poll_to_assessment',
    {
      description:
        'Turn an existing ungraded poll into a graded assessment. Requires the full replacement question set with correctOptionIndices on every question, because the stored questions were written as an ungraded poll and carry no correct answers. Converting an assessment back to an ungraded poll is not available via MCP.',
      inputSchema: convertPollToAssessmentInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => runTool('convert_poll_to_assessment', args as Record<string, unknown>),
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
