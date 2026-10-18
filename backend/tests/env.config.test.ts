import { describe, expect, it } from 'bun:test';
import { EnvValidationError, parseEnv } from '../src/common/config/env';

const PROD_BASE = {
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb+srv://user:pass@cluster.example/openpoll',
  REDIS_URL: 'rediss://default:pw@redis.example:6380',
  FRONTEND_URL: 'https://openpoll.example/',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  ID_SIGNING_SECRET: 'c'.repeat(48),
  RESEND_API_KEY: 're_live_key',
  RESEND_FROM_EMAIL: 'noreply@openpoll.example',
};

const problemsOf = (source: Record<string, string | undefined>) => {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as EnvValidationError).problems;
  }
  throw new Error('expected parseEnv to throw');
};

describe('env validation', () => {
  it('fills local defaults in development', () => {
    const { env } = parseEnv({});
    expect(env.isProduction).toBe(false);
    expect(env.MONGO_URI).toStartWith('mongodb://127.0.0.1');
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(env.FRONTEND_URL).toBe('http://localhost:3000');
    expect(env.allowedOrigins).toContain('http://127.0.0.1:3000');
    expect(env.google).toBeNull();
    expect(env.oidc).toBeNull();
  });

  it('accepts a complete production config and normalizes origins', () => {
    const { env, warnings } = parseEnv({ ...PROD_BASE, ALLOWED_ORIGINS: 'https://preview.example/path, https://b.example' });
    expect(env.FRONTEND_URL).toBe('https://openpoll.example');
    // Production never trusts localhost frontends.
    expect(env.allowedOrigins).toEqual(['https://openpoll.example', 'https://preview.example', 'https://b.example']);
    expect(warnings).toEqual([]);
  });

  it('lists every missing production requirement at once', () => {
    const problems = problemsOf({ NODE_ENV: 'production' });
    for (const name of ['MONGO_URI', 'REDIS_URL', 'FRONTEND_URL', 'JWT_REFRESH_SECRET', 'JWT_ACCESS_SECRET', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL']) {
      expect(problems.some((p) => p.includes(name))).toBe(true);
    }
  });

  it('rejects malformed values alongside missing ones', () => {
    const problems = problemsOf({ ...PROD_BASE, MONGO_URI: 'postgres://nope', REDIS_URL: undefined });
    expect(problems.some((p) => p.startsWith('MONGO_URI'))).toBe(true);
    expect(problems).toContain('REDIS_URL is required in production');
  });

  it('rejects .env.example placeholders in production', () => {
    const problems = problemsOf({ ...PROD_BASE, JWT_ACCESS_SECRET: 'replace_with_a_long_random_secret' });
    expect(problems).toContain('JWT_ACCESS_SECRET still holds the .env.example placeholder');
  });

  it('accepts legacy JWT_SECRET for the access secret', () => {
    const { env } = parseEnv({ ...PROD_BASE, JWT_ACCESS_SECRET: undefined, JWT_SECRET: 'd'.repeat(48) });
    expect(env.jwt.accessSecret).toBe('d'.repeat(48));
  });

  it('requires the rest of a provider group once any part is set', () => {
    expect(problemsOf({ GOOGLE_CLIENT_ID: 'id' })[0]).toContain('GOOGLE_CLIENT_SECRET');
    expect(problemsOf({ OIDC_CLIENT_SECRET: 'secret' })[0]).toContain('OIDC_CLIENT_ID');
    // Redirect URIs default locally but are mandatory in production.
    const prod = problemsOf({ ...PROD_BASE, OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 'secret' });
    expect(prod[0]).toContain('OIDC_REDIRECT_URI');
  });

  it('treats blank values as unset and the issuer alone as not enabling OIDC', () => {
    const { env } = parseEnv({ OIDC_ISSUER: 'https://id.example', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '  ' });
    expect(env.oidc).toBeNull();
  });

  it('resolves enabled providers with local redirect defaults in development', () => {
    const { env } = parseEnv({ PORT: '5001', OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 'secret' });
    expect(env.oidc).toEqual({
      issuer: 'https://id-backend.anands.dev',
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:5001/auth/callback',
    });
  });

  it('warns when production reuses secrets', () => {
    const { warnings } = parseEnv({ ...PROD_BASE, ID_SIGNING_SECRET: undefined, JWT_REFRESH_SECRET: PROD_BASE.JWT_ACCESS_SECRET });
    expect(warnings).toHaveLength(2);
  });
});
