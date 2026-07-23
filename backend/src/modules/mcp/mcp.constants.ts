export const MCP_TOKEN_PREFIX = 'opoll_mcp_';

export const MCP_SCOPES = [
  'poll:create',
  'poll:edit',
  'poll:read',
  'analytics:read',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_MAX_TOKENS_PER_USER = 5;

export const MCP_TOOL_SCOPES: Record<string, McpScope> = {
  list_polls: 'poll:read',
  get_poll: 'poll:read',
  create_poll: 'poll:create',
  edit_poll: 'poll:edit',
  get_poll_analytics: 'analytics:read',
  get_share_link: 'poll:read',
};

export function getMcpPublicUrl(): string {
  const explicit = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
  if (explicit) return explicit;

  const port = process.env.PORT || 5000;
  return `http://localhost:${port}`;
}

export function buildMcpConnectorConfig(rawToken: string): Record<string, unknown> {
  const mcpUrl = `${getMcpPublicUrl()}/mcp`;
  return {
    mcpServers: {
      'open-poll': {
        command: 'npx',
        args: [
          '-y',
          'mcp-remote',
          mcpUrl,
          '--header',
          `Authorization: Bearer ${rawToken}`,
        ],
      },
    },
  };
}
