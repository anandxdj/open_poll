import { describe, expect, it } from 'bun:test';
import { EnvValidationError, parseEnv } from '../src/common/config/env';

const problemsOf = (source: Record<string, string | undefined>) => {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as EnvValidationError).problems;
  }
  throw new Error('expected parseEnv to throw');
};

const HEX_KEY = 'a1'.repeat(32);
const STORAGE = {
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_BUCKET: 'openpoll-media',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_URL: 'https://media.example/',
};

describe('capabilities', () => {
  it('are all off without optional configuration', () => {
    expect(parseEnv({}).env.capabilities).toEqual({
      billing: false,
      storage: false,
      samlSso: false,
      scim: false,
      pptxHighFidelity: false,
      googleDriveImport: false,
      customDomains: false,
      metrics: false,
      ai: false,
    });
  });

  it('turn on with their configuration', () => {
    const { env } = parseEnv({
      ...STORAGE,
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      STRIPE_PRICE_PRO_MONTHLY: 'price_pro',
      ENCRYPTION_KEY: HEX_KEY,
      GOTENBERG_URL: 'http://gotenberg:3000/',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_DRIVE_IMPORT_ENABLED: 'true',
      GOOGLE_DRIVE_API_KEY: 'picker-key',
      GOOGLE_DRIVE_APP_ID: '123456789012',
      DOMAIN_PROVISIONER: 'caddy',
      DOMAIN_CNAME_TARGET: 'Domains.OpenPoll.example',
      METRICS_TOKEN: 'm'.repeat(32),
      GEMINI_API_KEY: 'AIza-real-key',
    });
    expect(Object.values(env.capabilities).every(Boolean)).toBe(true);
    expect(env.storage).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      region: 'auto',
      bucket: 'openpoll-media',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      publicUrl: 'https://media.example',
    });
    expect(env.billing?.prices).toEqual({ proMonthly: 'price_pro', proYearly: undefined, teamMonthly: undefined, teamYearly: undefined });
    expect(env.encryptionKey?.length).toBe(32);
    expect(env.gotenbergUrl).toBe('http://gotenberg:3000');
    expect(env.domains).toEqual({ provisioner: 'caddy', cnameTarget: 'domains.openpoll.example', vercel: null });
  });

  it('treats .env.example AI placeholders as no provider', () => {
    expect(parseEnv({ LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: 'your_llm_api_key', GEMINI_API_KEY: 'your_gemini_api_key' }).env.capabilities.ai).toBe(false);
    expect(parseEnv({ LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: 'sk-live' }).env.capabilities.ai).toBe(true);
    // An API key without its endpoint is not usable.
    expect(parseEnv({ LLM_API_KEY: 'sk-live' }).env.capabilities.ai).toBe(false);
  });

  it('leaves DOMAIN_PROVISIONER=none and an unflagged Drive key off', () => {
    const { env } = parseEnv({ DOMAIN_PROVISIONER: 'none', GOOGLE_DRIVE_API_KEY: 'picker-key' });
    expect(env.capabilities.customDomains).toBe(false);
    expect(env.capabilities.googleDriveImport).toBe(false);
  });
});

describe('optional group validation', () => {
  it('requires the rest of a partially configured group', () => {
    expect(problemsOf({ STRIPE_SECRET_KEY: 'sk_live_123' })[0]).toContain('STRIPE_WEBHOOK_SECRET');
    expect(problemsOf({ S3_BUCKET: 'media' })[0]).toContain('S3_PUBLIC_URL');
    expect(problemsOf({ S3_ENDPOINT: 'http://127.0.0.1:9000' })[0]).toContain('S3_BUCKET');
    expect(problemsOf({ DOMAIN_PROVISIONER: 'vercel', DOMAIN_CNAME_TARGET: 'cname.example.com' })[0]).toContain(
      'DOMAIN_VERCEL_TOKEN',
    );
  });

  it('requires Google OAuth and Picker credentials for Drive import', () => {
    const [problem] = problemsOf({ GOOGLE_DRIVE_IMPORT_ENABLED: 'true', GOOGLE_DRIVE_API_KEY: 'k' });
    expect(problem).toContain('GOOGLE_DRIVE_APP_ID');
    expect(problem).toContain('GOOGLE_CLIENT_ID');
  });

  it('rejects malformed values', () => {
    const problems = problemsOf({
      ENCRYPTION_KEY: 'too-short',
      STRIPE_SECRET_KEY: 'pk_test_publishable',
      STRIPE_WEBHOOK_SECRET: 'whsec_1',
      STRIPE_PRICE_TEAM_YEARLY: 'prod_123',
      METRICS_TOKEN: 'short',
      DOMAIN_PROVISIONER: 'nginx',
      GOTENBERG_URL: 'ftp://gotenberg',
    });
    for (const name of ['ENCRYPTION_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_TEAM_YEARLY', 'METRICS_TOKEN', 'DOMAIN_PROVISIONER', 'GOTENBERG_URL']) {
      expect(problems.some((problem) => problem.startsWith(name))).toBe(true);
    }
  });

  it('rejects .env.example placeholders for the new secrets in production', () => {
    const problems = problemsOf({
      NODE_ENV: 'production',
      METRICS_TOKEN: 'replace_with_a_metrics_token',
    });
    expect(problems).toContain('METRICS_TOKEN still holds the .env.example placeholder');
  });
});
