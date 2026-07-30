import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { buildMcpConnectorConfig, getMcpPublicUrl } from '../src/modules/mcp/mcp.constants';

const ENV_KEYS = ['API_PUBLIC_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'PORT'] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makeReq(headers: Record<string, string | string[]>, protocol?: string) {
  return { headers, protocol } as any;
}

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('getMcpPublicUrl', () => {
  it('prefers an explicit API_PUBLIC_URL over everything else', () => {
    process.env.API_PUBLIC_URL = 'https://api.example.com';
    process.env.VERCEL_URL = 'deployment.vercel.app';
    expect(getMcpPublicUrl(makeReq({ host: 'ignored.example.com' }))).toBe('https://api.example.com');
  });

  it('strips a trailing slash from API_PUBLIC_URL', () => {
    process.env.API_PUBLIC_URL = 'https://api.example.com/';
    expect(getMcpPublicUrl()).toBe('https://api.example.com');
  });

  // The production path: a fresh deploy with no MCP env vars must still hand out a
  // reachable URL rather than localhost.
  it('derives the origin from the request when no override is set', () => {
    expect(getMcpPublicUrl(makeReq({ host: 'openpoll.example.com' }, 'https'))).toBe(
      'https://openpoll.example.com',
    );
  });

  it('honours proxy forwarding headers over the internal host', () => {
    const req = makeReq(
      {
        host: 'internal-container:5000',
        'x-forwarded-host': 'openpoll.example.com',
        'x-forwarded-proto': 'https',
      },
      'http',
    );
    expect(getMcpPublicUrl(req)).toBe('https://openpoll.example.com');
  });

  it('takes the client-facing hop from a multi-proxy header', () => {
    const req = makeReq({
      'x-forwarded-host': 'openpoll.example.com, inner.internal',
      'x-forwarded-proto': 'https, http',
    });
    expect(getMcpPublicUrl(req)).toBe('https://openpoll.example.com');
  });

  it('keeps http for a local request so dev copies a working config', () => {
    expect(getMcpPublicUrl(makeReq({ host: 'localhost:5000' }, 'http'))).toBe('http://localhost:5000');
  });

  it('assumes https when a request carries no protocol hint', () => {
    expect(getMcpPublicUrl(makeReq({ host: 'openpoll.example.com' }))).toBe('https://openpoll.example.com');
  });

  it('falls back to the stable Vercel production domain for non-request callers', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'openpoll.vercel.app';
    process.env.VERCEL_URL = 'openpoll-abc123.vercel.app';
    expect(getMcpPublicUrl()).toBe('https://openpoll.vercel.app');
  });

  it('uses VERCEL_URL when no production domain is exposed', () => {
    process.env.VERCEL_URL = 'openpoll-abc123.vercel.app';
    expect(getMcpPublicUrl()).toBe('https://openpoll-abc123.vercel.app');
  });

  it('falls back to localhost on the configured port', () => {
    process.env.PORT = '4321';
    expect(getMcpPublicUrl()).toBe('http://localhost:4321');
  });

  it('ignores a request with no host header', () => {
    process.env.PORT = '5000';
    expect(getMcpPublicUrl(makeReq({}))).toBe('http://localhost:5000');
  });
});

describe('buildMcpConnectorConfig', () => {
  it('points mcp-remote at the supplied base URL', () => {
    const config = buildMcpConnectorConfig('opoll_mcp_token', 'https://openpoll.example.com');
    const server = (config.mcpServers as any)['open-poll'];
    expect(server.args).toContain('https://openpoll.example.com/mcp');
    expect(server.args).toContain('Authorization: Bearer opoll_mcp_token');
  });

  it('strips a trailing slash from the supplied base URL', () => {
    const config = buildMcpConnectorConfig('opoll_mcp_token', 'https://openpoll.example.com/');
    expect((config.mcpServers as any)['open-poll'].args).toContain('https://openpoll.example.com/mcp');
  });

  it('resolves the URL itself when no base URL is supplied', () => {
    process.env.API_PUBLIC_URL = 'https://api.example.com';
    const config = buildMcpConnectorConfig('opoll_mcp_token');
    expect((config.mcpServers as any)['open-poll'].args).toContain('https://api.example.com/mcp');
  });
});
