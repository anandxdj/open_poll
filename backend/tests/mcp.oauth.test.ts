import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { MCP_SCOPES } from '../src/modules/mcp/mcp.constants';
import { isAllowedRedirectUri, normalizeScopes, pkceMatches } from '../src/modules/mcp/oauth/oauth.service';

describe('MCP OAuth helpers', () => {
  it('accepts https, loopback http and app schemes as redirect addresses', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:33418/')).toBe(true);
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback')).toBe(true);
  });

  it('refuses redirect addresses that could run code or leak codes', () => {
    expect(isAllowedRedirectUri('http://evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('data:text/html,hi')).toBe(false);
    expect(isAllowedRedirectUri('file:///etc/passwd')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/cb#fragment')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
  });

  it('checks the PKCE S256 verifier', () => {
    const verifier = 'a'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches('b'.repeat(43), challenge)).toBe(false);
    expect(pkceMatches('short', createHash('sha256').update('short').digest('base64url'))).toBe(false);
    expect(pkceMatches(undefined, challenge)).toBe(false);
  });

  it('keeps known scopes and asks for all when none are known', () => {
    expect(normalizeScopes(['deck:read', 'openid', 'deck:read'])).toEqual(['deck:read']);
    expect(normalizeScopes(['openid', 'profile'])).toEqual([...MCP_SCOPES]);
    expect(normalizeScopes(undefined)).toEqual([...MCP_SCOPES]);
  });
});
