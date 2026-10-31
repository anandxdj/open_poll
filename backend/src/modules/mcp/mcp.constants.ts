export const MCP_TOKEN_PREFIX = 'opoll_mcp_';
/** OAuth access tokens (remote connectors). Opaque, stored as a sha256 hash like PATs. */
export const MCP_OAUTH_ACCESS_PREFIX = 'opoll_oat_';
/** OAuth refresh tokens: rotated on every use. */
export const MCP_OAUTH_REFRESH_PREFIX = 'opoll_ort_';

export const MCP_SCOPES = [
  'poll:create',
  'poll:edit',
  'poll:read',
  'analytics:read',
  'deck:read',
  'deck:write',
  'session:run',
  'results:read',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * What a token issued before decks reached MCP carries. Those tokens are not
 * widened: a secret already pasted somewhere keeps the power it was issued
 * with, and settings labels it "polls only".
 */
export const MCP_POLL_ONLY_SCOPES: readonly McpScope[] = ['poll:create', 'poll:edit', 'poll:read', 'analytics:read'];

/** Shown on the OAuth consent page and in settings. */
export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  'poll:read': 'See your polls and assessments',
  'poll:create': 'Create polls and assessments',
  'poll:edit': 'Edit your polls and assessments',
  'analytics:read': 'Read poll vote counts',
  'deck:read': 'See decks, slide types and themes',
  'deck:write': 'Create and edit decks',
  'session:run': 'Run live sessions: open the lobby, move slides, reveal and end',
  'results:read': 'Read session results, Q&A and workspace insights',
};

export const MCP_MAX_TOKENS_PER_USER = 5;

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
