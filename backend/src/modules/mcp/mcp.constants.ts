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

// Enough of an Express request to read the origin off, without importing express here.
type OriginSource = {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  // A proxy chain sends "a, b"; the client-facing hop is first.
  return raw?.split(',')[0]?.trim() || undefined;
}

function originFromRequest(req?: OriginSource): string | undefined {
  if (!req) return undefined;

  // app.ts sets 'trust proxy', so x-forwarded-* is what Vercel/nginx put there.
  const host = firstHeader(req.headers['x-forwarded-host']) ?? firstHeader(req.headers.host);
  if (!host) return undefined;

  const proto = firstHeader(req.headers['x-forwarded-proto']) ?? req.protocol ?? 'https';
  return `${proto}://${host}`;
}

// The connector config is copied into the user's MCP client, so this URL has to be
// reachable from outside the container. API_PUBLIC_URL stays the operator override,
// but it is easy to forget on a new deploy and the old localhost fallback shipped a
// config that could never connect — so derive the backend's own origin from the
// request instead, and only fall back to localhost in development.
//
// Host/x-forwarded-host is client-controlled, which is safe here: the value is
// echoed straight back to the authenticated caller that sent it and is never
// stored, emailed, or shown to another user.
export function getMcpPublicUrl(req?: OriginSource): string {
  const explicit = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
  if (explicit) return explicit;

  const requestOrigin = originFromRequest(req);
  if (requestOrigin) return requestOrigin;

  // Non-request callers on Vercel: prefer the stable production domain over the
  // per-deployment URL, which changes on every push.
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/\/$/, '')}`;

  const port = process.env.PORT || 5000;
  return `http://localhost:${port}`;
}

export function buildMcpConnectorConfig(rawToken: string, baseUrl?: string): Record<string, unknown> {
  const mcpUrl = `${baseUrl?.replace(/\/$/, '') ?? getMcpPublicUrl()}/mcp`;
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
