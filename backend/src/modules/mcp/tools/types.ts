import type { ZodRawShape } from 'zod';
import type { McpScope } from '../mcp.constants';
import type { McpUserContext } from '../mcp.context';

/**
 * One MCP tool: what an agent reads in tools/list and what runs when it calls.
 * The server registers straight from these definitions and the dispatcher
 * checks the scope from the same object, so the advertised schema, the
 * required scope and the executed code cannot drift apart.
 */
export interface McpToolDef {
  name: string;
  /** Token scope the tool needs; null for introspection any token may call. */
  scope: McpScope | null;
  description: string;
  /** Raw zod shape; handlers parse their args with z.object(inputShape). */
  inputShape?: ZodRawShape;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
  };
  handler(args: Record<string, unknown> | undefined, ctx: McpUserContext): Promise<unknown>;
}

export const defineTool = (def: McpToolDef): McpToolDef => def;
