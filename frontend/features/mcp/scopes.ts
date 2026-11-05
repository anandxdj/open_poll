/**
 * MCP scopes as settings shows them (backend `MCP_SCOPES`). Tokens issued
 * before decks reached MCP carry only the poll scopes and are labelled
 * "Polls only": they keep working for polls and are never widened.
 */
export const MCP_SCOPE_NAMES: Record<string, string> = {
  "poll:read": "Read polls",
  "poll:create": "Create polls",
  "poll:edit": "Edit polls",
  "analytics:read": "Poll results",
  "deck:read": "Read decks",
  "deck:write": "Edit decks",
  "session:run": "Run sessions",
  "results:read": "Session results",
};

export const scopeName = (scope: string) => MCP_SCOPE_NAMES[scope] ?? scope;

/** A token from before deck, live and results tools: it can only manage polls. */
export const isPollOnly = (scopes: readonly string[]) => !scopes.includes("deck:read") && !scopes.includes("session:run");
