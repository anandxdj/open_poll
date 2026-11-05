import apiClient from '@/lib/api-client';

export type McpTokenMeta = {
  id: string;
  prefix: string;
  last4: string;
  label: string;
  scopes: string[];
  /** Pinned workspace; null = follows the user's default workspace. */
  workspaceId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type CreateMcpTokenResponse = {
  token: string;
  connectorConfig: Record<string, unknown>;
  meta: McpTokenMeta;
  mcpUrl: string;
};

/** An app connected through sign-in (an OAuth grant): Claude, ChatGPT, an IDE. */
export type McpGrant = {
  id: string;
  clientName: string;
  workspace: { id: string; name: string | null };
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type ConsentScope = { scope: string; label: string };

export type ConsentWorkspace = { id: string; name: string; type: 'personal' | 'team'; role: string; plan: string };

/** `GET /api/oauth/requests/:id`: what the consent page shows. */
export type ConsentRequest = {
  request: {
    client: { name: string; redirectTo: string };
    scopes: ConsentScope[];
    expiresAt: string;
  };
  workspaces: ConsentWorkspace[];
  defaultWorkspaceId: string;
};

export async function createMcpToken(label: string, workspaceId?: string | null) {
  const res = await apiClient.post<{ data: CreateMcpTokenResponse }>('/mcp/tokens', {
    label,
    ...(workspaceId ? { workspaceId } : {}),
  });
  return res.data.data;
}

export async function listMcpTokens() {
  const res = await apiClient.get<{ data: { tokens: McpTokenMeta[]; mcpUrl: string } }>('/mcp/tokens');
  return res.data.data;
}

export async function revokeMcpToken(tokenId: string) {
  await apiClient.delete(`/mcp/tokens/${tokenId}`);
}

export async function listMcpGrants() {
  const res = await apiClient.get<{ data: { grants: McpGrant[] } }>('/mcp/grants');
  return res.data.data.grants;
}

export async function revokeMcpGrant(grantId: string) {
  await apiClient.delete(`/mcp/grants/${grantId}`);
}

// The consent API ignores X-Workspace-Id: the workspace the app may act in is
// the user's choice on the consent page, sent in the approve body.
export async function getConsentRequest(requestId: string) {
  const res = await apiClient.get<{ data: ConsentRequest }>(`/oauth/requests/${encodeURIComponent(requestId)}`);
  return res.data.data;
}

export async function approveConsent(requestId: string, choice: { workspaceId: string; scopes: string[] }) {
  const res = await apiClient.post<{ data: { redirectUrl: string } }>(
    `/oauth/requests/${encodeURIComponent(requestId)}/approve`,
    choice,
  );
  return res.data.data.redirectUrl;
}

export async function denyConsent(requestId: string) {
  const res = await apiClient.post<{ data: { redirectUrl: string } }>(`/oauth/requests/${encodeURIComponent(requestId)}/deny`);
  return res.data.data.redirectUrl;
}
