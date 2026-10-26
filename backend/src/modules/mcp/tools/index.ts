import { CONTEXT_TOOLS } from './context';
import { DECK_TOOLS } from './decks';
import { POLL_TOOLS } from './polls';
import type { McpToolDef } from './types';

/** Every MCP tool, in the order tools/list shows them. */
export const MCP_TOOLS: readonly McpToolDef[] = [...CONTEXT_TOOLS, ...DECK_TOOLS, ...POLL_TOOLS];
