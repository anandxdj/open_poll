import { z } from 'zod';

/**
 * Central environment validation (security hardening #14).
 *
 * Parsed once, when this module is first imported. `app.ts` imports it before
 * anything else so a misconfigured deploy fails at boot with every problem
 * listed, instead of on the first login. Production must set real values;
 * development and test fall back to local defaults.
 *
 * The auth module, common/config, jwt.utils and the platform primitives
 * (plans, storage, crypto, capabilities) read from here; other modules still
 * read process.env directly.
 */

const DEV_DEFAULTS = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/open-poll-platform',
  REDIS_URL: 'redis://127.0.0.1:6379',
  FRONTEND_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
} as const;

/** Local frontends trusted outside production only. */
const DEV_FRONTEND_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const DEFAULT_OIDC_ISSUER = 'https://id-backend.anands.dev';

/** Values copied verbatim from .env.example that must never reach production. */
const PLACEHOLDER = /^(your_|replace_with_|change_?me)/i;
const SECRET_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ID_SIGNING_SECRET',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'GOOGLE_DRIVE_API_KEY',
  'DOMAIN_VERCEL_TOKEN',
  'METRICS_TOKEN',
] as const;

/** Mirrors AiService.isPlaceholder: .env.example values that mean "no AI provider". */
const AI_PLACEHOLDER = /^(your_|dummy_|changeme)/i;

/** ENCRYPTION_KEY is 32 random bytes, as 64 hex characters or (URL-safe) base64. */
export function decodeEncryptionKey(value: string): Buffer | null {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    const key = Buffer.from(value, 'base64');
    if (key.length === 32) return key;
  }
  return null;
}

// `FOO=` in a .env file means "unset", not "empty string".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' ? value.trim() || undefined : value), schema.optional());

const httpUrl = z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' });
const stripePriceId = z.string().regex(/^price_/, 'must be a Stripe price id (price_…)');
const hostname = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, 'must be a hostname');

const rawEnvSchema = z.object({
  NODE_ENV: optional(z.string()),
  PORT: optional(z.coerce.number().int().min(1).max(65535)),
  MONGO_URI: optional(z.string().regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://')),
  FORCE_PUBLIC_DNS: optional(z.string()),
  REDIS_URL: optional(z.string().regex(/^rediss?:\/\//, 'must start with redis:// or rediss://')),
  FRONTEND_URL: optional(httpUrl),
  API_PUBLIC_URL: optional(httpUrl),
  ALLOWED_ORIGINS: optional(z.string()),
  JWT_ACCESS_SECRET: optional(z.string()),
  JWT_SECRET: optional(z.string()),
  JWT_REFRESH_SECRET: optional(z.string()),
  JWT_ACCESS_EXPIRES_IN: optional(z.string()),
  JWT_REFRESH_EXPIRES_IN: optional(z.string()),
  ID_SIGNING_SECRET: optional(z.string()),
  RESEND_API_KEY: optional(z.string()),
  RESEND_FROM_EMAIL: optional(z.email()),
  RESEND_FROM_NAME: optional(z.string()),
  SMTP_FROM_EMAIL: optional(z.email()),
  SMTP_FROM_NAME: optional(z.string()),
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),
  GOOGLE_REDIRECT_URI: optional(httpUrl),
  OIDC_ISSUER: optional(httpUrl),
  OIDC_CLIENT_ID: optional(z.string()),
  OIDC_CLIENT_SECRET: optional(z.string()),
  OIDC_REDIRECT_URI: optional(httpUrl),
  // AI providers: ai.service reads these itself; parsed here only for the capability.
  LLM_BASE_URL: optional(z.string()),
  LLM_API_KEY: optional(z.string()),
  GEMINI_API_KEY: optional(z.string()),
  ENCRYPTION_KEY: optional(
    z.string().refine((value) => decodeEncryptionKey(value) !== null, 'must be 32 bytes as 64 hex characters or base64'),
  ),
  STRIPE_SECRET_KEY: optional(z.string().regex(/^(sk|rk)_(test|live)_/, 'must be a Stripe secret key (sk_test_…/sk_live_…)')),
  STRIPE_WEBHOOK_SECRET: optional(z.string().regex(/^whsec_/, 'must be a Stripe webhook secret (whsec_…)')),
  STRIPE_PRICE_PRO_MONTHLY: optional(stripePriceId),
  STRIPE_PRICE_PRO_YEARLY: optional(stripePriceId),
  STRIPE_PRICE_TEAM_MONTHLY: optional(stripePriceId),
  STRIPE_PRICE_TEAM_YEARLY: optional(stripePriceId),
  S3_ENDPOINT: optional(httpUrl),
  S3_REGION: optional(z.string()),
  S3_BUCKET: optional(z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')),
  S3_ACCESS_KEY_ID: optional(z.string()),
  S3_SECRET_ACCESS_KEY: optional(z.string()),
  S3_PUBLIC_URL: optional(httpUrl),
  GOTENBERG_URL: optional(httpUrl),
  GOOGLE_DRIVE_IMPORT_ENABLED: optional(z.enum(['true', 'false'], { error: 'must be true or false' })),
  GOOGLE_DRIVE_API_KEY: optional(z.string()),
  GOOGLE_DRIVE_APP_ID: optional(z.string().regex(/^\d+$/, 'must be the numeric Google Cloud project number')),
  DOMAIN_PROVISIONER: optional(z.enum(['none', 'vercel', 'caddy'], { error: 'must be none, vercel or caddy' })),
  DOMAIN_CNAME_TARGET: optional(hostname),
  DOMAIN_VERCEL_TOKEN: optional(z.string()),
  DOMAIN_VERCEL_PROJECT_ID: optional(z.string()),
  DOMAIN_VERCEL_TEAM_ID: optional(z.string()),
  METRICS_TOKEN: optional(z.string().min(16, 'must be at least 16 characters')),
  SOCKET_REDIS_ADAPTER: optional(z.enum(['on', 'off'], { error: 'must be on or off' })),
});

type RawEnv = z.infer<typeof rawEnvSchema>;

/**
 * Optional features this deployment can offer, derived from configuration only
 * (plan entitlements are separate). Served by GET /api/capabilities so the
 * frontend can disable what is unavailable and say why.
 */
export interface Capabilities {
  /** Stripe checkout, portal and webhooks (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET). */
  billing: boolean;
  /** S3-compatible object storage for uploads, imports and exports (S3_*). */
  storage: boolean;
  /** Per-workspace SAML / OIDC SSO; needs ENCRYPTION_KEY for IdP client secrets at rest. */
  samlSso: boolean;
  /** SCIM provisioning. SCIM users sign in through SSO, so it follows samlSso. */
  scim: boolean;
  /** Rendered PPTX import fallback through Gotenberg (GOTENBERG_URL). */
  pptxHighFidelity: boolean;
  /** Private Google Slides import through the Drive API and Picker. */
  googleDriveImport: boolean;
  /** Custom domains through a provisioner (DOMAIN_PROVISIONER). */
  customDomains: boolean;
  /** Prometheus /metrics behind a bearer token (METRICS_TOKEN). */
  metrics: boolean;
  /** Real AI generation (LLM_BASE_URL + LLM_API_KEY, or GEMINI_API_KEY); otherwise mock drafts. */
  ai: boolean;
}

export interface AppEnv {
  NODE_ENV: string;
  isProduction: boolean;
  PORT: number;
  MONGO_URI: string;
  FORCE_PUBLIC_DNS: boolean;
  REDIS_URL: string;
  /** Primary frontend URL (no trailing slash) used for redirects and email links. */
  FRONTEND_URL: string;
  /** Origins trusted for credentialed CORS and cookie-authenticated auth endpoints. */
  allowedOrigins: string[];
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  /** Without an API key, emails are logged instead of sent (development only). */
  mail: { resendApiKey?: string; fromEmail?: string; fromName: string };
  /** null when Google sign-in is not configured. */
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
  /** null when OIDC sign-in is not configured. */
  oidc: { issuer: string; clientId: string; clientSecret: string; redirectUri: string } | null;
  /**
   * The API's own public origin (API_PUBLIC_URL, else http://localhost:PORT), no trailing slash.
   * SSO builds its SAML entity id, ACS and OIDC redirect URLs from it, never from request headers.
   */
  apiPublicUrl: string;
  /** AES-256-GCM key for secrets at rest (common/utils/crypto); null when ENCRYPTION_KEY is unset. */
  encryptionKey: Buffer | null;
  /** null when Stripe billing is not configured. Price ids map Stripe prices to plans. */
  billing: {
    secretKey: string;
    webhookSecret: string;
    prices: { proMonthly?: string; proYearly?: string; teamMonthly?: string; teamYearly?: string };
  } | null;
  /** null when object storage is not configured (uploads answer 503 STORAGE_DISABLED). */
  storage: {
    /** Omitted for AWS S3, where the endpoint follows from the region. */
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** Public/CDN base URL objects are served from (no trailing slash). */
    publicUrl: string;
  } | null;
  /** Gotenberg base URL for high-fidelity PPTX rendering; null when unset. */
  gotenbergUrl: string | null;
  /** null unless GOOGLE_DRIVE_IMPORT_ENABLED=true with its credentials and Google OAuth. */
  googleDriveImport: { apiKey: string; appId: string } | null;
  /** null when custom domains are off (DOMAIN_PROVISIONER unset or none). */
  domains: {
    provisioner: 'vercel' | 'caddy';
    /** Hostname customers point their CNAME at. */
    cnameTarget: string;
    vercel: { token: string; projectId: string; teamId?: string } | null;
  } | null;
  /** Bearer token for /metrics; null disables the endpoint. */
  metricsToken: string | null;
  /** SOCKET_REDIS_ADAPTER=on: link Socket.io servers through Redis (multi-instance rooms and fetchSockets). */
  socketRedisAdapter: boolean;
  capabilities: Capabilities;
}

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'See backend/.env.example.',
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Optional providers are enabled by any of their trigger settings. A
 * half-configured provider is a deploy mistake, so the rest become required.
 */
function checkGroup(
  raw: RawEnv,
  label: string,
  triggers: (keyof RawEnv)[],
  required: (keyof RawEnv)[],
  problems: string[],
): boolean {
  const present = triggers.filter((key) => raw[key] !== undefined);
  if (present.length === 0) return false;
  const missing = required.filter((key) => raw[key] === undefined);
  if (missing.length > 0) {
    problems.push(`${label} is partially configured (${present.join(', ')} set): also set ${missing.join(', ')}`);
  }
  return true;
}

function toOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Pure parser; `source` defaults to process.env. Throws EnvValidationError listing every problem. */
export function parseEnv(source: Record<string, string | undefined> = process.env): {
  env: AppEnv;
  warnings: string[];
} {
  const problems: string[] = [];
  const warnings: string[] = [];

  // Report malformed values, then keep checking the rest so one boot lists everything.
  let parsed = rawEnvSchema.safeParse(source);
  const malformed = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      malformed.add(String(issue.path[0]));
      problems.push(`${issue.path.join('.')} ${issue.message}`);
    }
    parsed = rawEnvSchema.safeParse(
      Object.fromEntries(Object.entries(source).filter(([key]) => !malformed.has(key))),
    );
  }
  const raw: RawEnv = parsed.success ? parsed.data : {};

  const NODE_ENV = raw.NODE_ENV ?? 'development';
  const isProduction = NODE_ENV === 'production';
  const PORT = raw.PORT ?? 5000;

  if (isProduction) {
    for (const key of ['MONGO_URI', 'REDIS_URL', 'FRONTEND_URL', 'JWT_REFRESH_SECRET', 'RESEND_API_KEY'] as const) {
      if (raw[key] === undefined && !malformed.has(key)) problems.push(`${key} is required in production`);
    }
    if (!raw.JWT_ACCESS_SECRET && !raw.JWT_SECRET) {
      problems.push('JWT_ACCESS_SECRET (or legacy JWT_SECRET) is required in production');
    }
    if (!raw.RESEND_FROM_EMAIL && !raw.SMTP_FROM_EMAIL) {
      problems.push('RESEND_FROM_EMAIL is required in production');
    }
    for (const key of SECRET_KEYS) {
      const value = raw[key];
      if (value && PLACEHOLDER.test(value)) problems.push(`${key} still holds the .env.example placeholder`);
    }
  }

  if (raw.RESEND_API_KEY && !raw.RESEND_FROM_EMAIL && !raw.SMTP_FROM_EMAIL) {
    problems.push('RESEND_API_KEY is set: also set RESEND_FROM_EMAIL');
  }

  // Redirect URIs have local defaults in development but must be explicit in production.
  const googleEnabled = checkGroup(
    raw,
    'Google OAuth',
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
    isProduction
      ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']
      : ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    problems,
  );
  // OIDC_ISSUER alone does not enable OIDC: it has a built-in default.
  const oidcEnabled = checkGroup(
    raw,
    'OIDC',
    ['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'],
    isProduction
      ? ['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI']
      : ['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'],
    problems,
  );

  const billingEnabled = checkGroup(
    raw,
    'Stripe billing',
    [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_PRO_MONTHLY',
      'STRIPE_PRICE_PRO_YEARLY',
      'STRIPE_PRICE_TEAM_MONTHLY',
      'STRIPE_PRICE_TEAM_YEARLY',
    ],
    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    problems,
  );
  // S3_ENDPOINT is optional for AWS S3; S3_REGION defaults to "auto" (R2, MinIO).
  const storageEnabled = checkGroup(
    raw,
    'Object storage',
    ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'],
    ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'],
    problems,
  );

  // Only the flag enables Drive import; its credentials alone are inert.
  let googleDriveImportEnabled = false;
  if (raw.GOOGLE_DRIVE_IMPORT_ENABLED === 'true') {
    const missing: string[] = (['GOOGLE_DRIVE_API_KEY', 'GOOGLE_DRIVE_APP_ID'] as const).filter(
      (key) => raw[key] === undefined,
    );
    // The Drive scope is requested through the Google sign-in OAuth client.
    if (!googleEnabled) missing.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
    if (missing.length > 0) problems.push(`GOOGLE_DRIVE_IMPORT_ENABLED is true: also set ${missing.join(', ')}`);
    else googleDriveImportEnabled = true;
  }

  const provisioner = raw.DOMAIN_PROVISIONER === 'none' ? undefined : raw.DOMAIN_PROVISIONER;
  if (provisioner) {
    const required: (keyof RawEnv)[] =
      provisioner === 'vercel'
        ? ['DOMAIN_CNAME_TARGET', 'DOMAIN_VERCEL_TOKEN', 'DOMAIN_VERCEL_PROJECT_ID']
        : ['DOMAIN_CNAME_TARGET'];
    const missing = required.filter((key) => raw[key] === undefined && !malformed.has(key));
    if (missing.length > 0) problems.push(`DOMAIN_PROVISIONER=${provisioner}: also set ${missing.join(', ')}`);
  }

  const FRONTEND_URL = (raw.FRONTEND_URL ?? DEV_DEFAULTS.FRONTEND_URL).replace(/\/+$/, '');
  const extraOrigins: string[] = [];
  for (const entry of (raw.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const origin = toOrigin(entry);
    if (origin) extraOrigins.push(origin);
    else problems.push(`ALLOWED_ORIGINS entry "${entry}" is not an http(s) origin`);
  }

  if (problems.length > 0) throw new EnvValidationError(problems);

  const accessSecret = raw.JWT_ACCESS_SECRET ?? raw.JWT_SECRET ?? DEV_DEFAULTS.JWT_ACCESS_SECRET;
  const refreshSecret = raw.JWT_REFRESH_SECRET ?? DEV_DEFAULTS.JWT_REFRESH_SECRET;

  if (isProduction) {
    if (!raw.ID_SIGNING_SECRET) {
      warnings.push('ID_SIGNING_SECRET is unset; signed ballot/guest tokens fall back to the JWT access secret');
    }
    if (accessSecret === refreshSecret) {
      warnings.push('JWT access and refresh secrets are identical; refresh tokens would verify as access tokens');
    }
  }

  const encryptionKey = raw.ENCRYPTION_KEY ? decodeEncryptionKey(raw.ENCRYPTION_KEY) : null;
  const usable = (value: string | undefined) => Boolean(value && !AI_PLACEHOLDER.test(value));
  const billing: AppEnv['billing'] = billingEnabled
    ? {
        secretKey: raw.STRIPE_SECRET_KEY!,
        webhookSecret: raw.STRIPE_WEBHOOK_SECRET!,
        prices: {
          proMonthly: raw.STRIPE_PRICE_PRO_MONTHLY,
          proYearly: raw.STRIPE_PRICE_PRO_YEARLY,
          teamMonthly: raw.STRIPE_PRICE_TEAM_MONTHLY,
          teamYearly: raw.STRIPE_PRICE_TEAM_YEARLY,
        },
      }
    : null;
  const storage: AppEnv['storage'] = storageEnabled
    ? {
        endpoint: raw.S3_ENDPOINT,
        region: raw.S3_REGION ?? 'auto',
        bucket: raw.S3_BUCKET!,
        accessKeyId: raw.S3_ACCESS_KEY_ID!,
        secretAccessKey: raw.S3_SECRET_ACCESS_KEY!,
        publicUrl: raw.S3_PUBLIC_URL!.replace(/\/+$/, ''),
      }
    : null;
  const domains: AppEnv['domains'] = provisioner
    ? {
        provisioner,
        cnameTarget: raw.DOMAIN_CNAME_TARGET!.toLowerCase(),
        vercel:
          provisioner === 'vercel'
            ? {
                token: raw.DOMAIN_VERCEL_TOKEN!,
                projectId: raw.DOMAIN_VERCEL_PROJECT_ID!,
                teamId: raw.DOMAIN_VERCEL_TEAM_ID,
              }
            : null,
      }
    : null;
  const googleDriveImport = googleDriveImportEnabled
    ? { apiKey: raw.GOOGLE_DRIVE_API_KEY!, appId: raw.GOOGLE_DRIVE_APP_ID! }
    : null;
  const gotenbergUrl = raw.GOTENBERG_URL?.replace(/\/+$/, '') ?? null;
  const metricsToken = raw.METRICS_TOKEN ?? null;

  const env: AppEnv = {
    NODE_ENV,
    isProduction,
    PORT,
    MONGO_URI: raw.MONGO_URI ?? DEV_DEFAULTS.MONGO_URI,
    FORCE_PUBLIC_DNS: raw.FORCE_PUBLIC_DNS === 'true',
    REDIS_URL: raw.REDIS_URL ?? DEV_DEFAULTS.REDIS_URL,
    FRONTEND_URL,
    allowedOrigins: [
      ...new Set([new URL(FRONTEND_URL).origin, ...extraOrigins, ...(isProduction ? [] : DEV_FRONTEND_ORIGINS)]),
    ],
    jwt: {
      accessSecret,
      refreshSecret,
      accessExpiresIn: raw.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshExpiresIn: raw.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
    mail: {
      resendApiKey: raw.RESEND_API_KEY,
      fromEmail: raw.RESEND_FROM_EMAIL ?? raw.SMTP_FROM_EMAIL,
      fromName: raw.RESEND_FROM_NAME ?? raw.SMTP_FROM_NAME ?? 'OpenPoll',
    },
    google: googleEnabled
      ? {
          clientId: raw.GOOGLE_CLIENT_ID!,
          clientSecret: raw.GOOGLE_CLIENT_SECRET!,
          redirectUri: raw.GOOGLE_REDIRECT_URI ?? `http://localhost:${PORT}/api/auth/google/callback`,
        }
      : null,
    oidc: oidcEnabled
      ? {
          issuer: raw.OIDC_ISSUER ?? DEFAULT_OIDC_ISSUER,
          clientId: raw.OIDC_CLIENT_ID!,
          clientSecret: raw.OIDC_CLIENT_SECRET!,
          redirectUri: raw.OIDC_REDIRECT_URI ?? `http://localhost:${PORT}/auth/callback`,
        }
      : null,
    apiPublicUrl: (raw.API_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, ''),
    encryptionKey,
    billing,
    storage,
    gotenbergUrl,
    googleDriveImport,
    domains,
    metricsToken,
    socketRedisAdapter: raw.SOCKET_REDIS_ADAPTER === 'on',
    capabilities: {
      billing: billing !== null,
      storage: storage !== null,
      samlSso: encryptionKey !== null,
      scim: encryptionKey !== null,
      pptxHighFidelity: gotenbergUrl !== null,
      googleDriveImport: googleDriveImport !== null,
      customDomains: domains !== null,
      metrics: metricsToken !== null,
      ai: (usable(raw.LLM_BASE_URL) && usable(raw.LLM_API_KEY)) || usable(raw.GEMINI_API_KEY),
    },
  };

  return { env, warnings };
}

function loadEnv(): AppEnv {
  const { env, warnings } = parseEnv(process.env);
  for (const warning of warnings) console.warn(`[Env] ${warning}`);
  return env;
}

export const env: AppEnv = loadEnv();
