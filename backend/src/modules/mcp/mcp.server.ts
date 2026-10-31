import { ZodError } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleMcpTool, getMcpServerInstructions, toolsForScopes } from './mcp.tools.js';
import type { McpUserContext } from './mcp.context.js';
import { registerMcpPrompts } from './mcp.prompts.js';
import { registerMcpResources } from './mcp.resources.js';

export type McpSessionContext = McpUserContext;

/** The text block every tool answers with: the result as pretty JSON. */
const asText = (value: unknown) => ({ type: 'text' as const, text: JSON.stringify(value, null, 2) });

/**
 * An error an agent can act on: zod issues become one "path: message" line
 * each instead of a JSON dump, so the model sees which field to fix.
 */
function toolErrorText(error: unknown): string {
  if (error instanceof ZodError) {
    const lines = error.issues
      .slice(0, 20)
      .map((issue) => (issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message));
    return `Invalid arguments:\n${lines.join('\n')}`;
  }
  return error instanceof Error ? error.message : 'Tool execution failed';
}

/**
 * A server for one request. The transport is stateless, so the context (user,
 * pinned workspace, scopes) is read from the bearer token on every call and
 * never outlives it: a rotated OAuth token or a revoked scope applies at once.
 */
export function createMcpServer(ctx: McpSessionContext): McpServer {
  const server = new McpServer(
    {
      name: 'open-poll',
      version: '2.0.0',
    },
    {
      instructions: getMcpServerInstructions(),
    },
  );

  const runTool = async (name: string, args: Record<string, unknown> | undefined) => {
    try {
      const result = await handleMcpTool(name, args, ctx);
      return { content: [asText(result)] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: toolErrorText(error) }],
      };
    }
  };

  // Only the tools this token's scopes allow are listed; handleMcpTool checks
  // the scope again, so an unlisted tool called by name is still refused.
  for (const tool of toolsForScopes(ctx.scopes)) {
    if (tool.inputShape) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputShape, annotations: tool.annotations },
        async (args) => runTool(tool.name, args as Record<string, unknown>),
      );
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description, annotations: tool.annotations },
        async () => runTool(tool.name, {}),
      );
    }
  }

  registerMcpResources(server, ctx);
  registerMcpPrompts(server, ctx);

  return server;
}
