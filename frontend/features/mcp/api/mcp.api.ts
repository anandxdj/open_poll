import apiClient from '@/lib/api-client';

export type McpTokenMeta = {
  id: string;
  prefix: string;
  last4: string;
  label: string;
  scopes: string[];
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

export async function createMcpToken(label: string) {
  const res = await apiClient.post<{ data: CreateMcpTokenResponse }>('/mcp/tokens', { label });
  return res.data.data;
}

export async function listMcpTokens() {
  const res = await apiClient.get<{ data: { tokens: McpTokenMeta[]; mcpUrl: string } }>('/mcp/tokens');
  return res.data.data;
}

export async function revokeMcpToken(tokenId: string) {
  await apiClient.delete(`/mcp/tokens/${tokenId}`);
}
