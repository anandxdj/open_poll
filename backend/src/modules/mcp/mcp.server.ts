import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleMcpTool, getMcpServerInstructions } from './mcp.tools.js';
import type { McpScope } from './mcp.constants.js';

export type McpSessionContext = {
  userId: string;
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
        'Create a new poll. Defaults to published (live) unless isPublished is false. expiresAt defaults to 30 days from now.',
      inputSchema: {
        title: z.string().describe('Poll title'),
        isAnonymous: z.boolean().optional().describe('Whether responses are anonymous (default true)'),
        expiresAt: z.string().optional().describe('ISO expiry datetime; defaults to 30 days from now'),
        isPublished: z.boolean().optional().describe('Whether the poll is live (default true)'),
        questions: z.array(
          z.object({
            text: z.string(),
            options: z.array(z.string()).min(2),
            isMandatory: z.boolean().optional(),
          }),
        ).describe('Poll questions'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => runTool('create_poll', args as Record<string, unknown>),
  );

  server.registerTool(
    'edit_poll',
    {
      description: 'Update an owned poll. Cannot edit closed polls. Cannot delete polls via MCP.',
      inputSchema: {
        pollId: z.string().describe('Poll ID to update'),
        title: z.string().optional(),
        isAnonymous: z.boolean().optional(),
        expiresAt: z.string().optional(),
        isPublished: z.boolean().optional(),
        questions: z.array(
          z.object({
            text: z.string(),
            options: z.array(z.string()).min(2),
            isMandatory: z.boolean().optional(),
          }),
        ).optional(),
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
