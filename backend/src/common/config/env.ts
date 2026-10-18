import { z } from 'zod';

/**
 * Central environment validation (security hardening #14).
 *
 * Parsed once, when this module is first imported. `app.ts` imports it before
 * anything else so a misconfigured deploy fails at boot with every problem
 * listed, instead of on the first login. Production must set real values;
 * development and test fall back to local defaults.
 *
 * The auth module, common/config and jwt.utils read from here; other modules
 * still read process.env directly.
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
] as const;

// `FOO=` in a .env file means "unset", not "empty string".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' ? value.trim() || undefined : value), schema.optional());

const httpUrl = z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' });

const rawEnvSchema = z.object({
  NODE_ENV: optional(z.string()),
  PORT: optional(z.coerce.number().int().min(1).max(65535)),
  MONGO_URI: optional(z.string().regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://')),
  FORCE_PUBLIC_DNS: optional(z.string()),
  REDIS_URL: optional(z.string().regex(/^rediss?:\/\//, 'must start with redis:// or rediss://')),
  FRONTEND_URL: optional(httpUrl),
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
});

type RawEnv = z.infer<typeof rawEnvSchema>;

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
  };

  return { env, warnings };
}

function loadEnv(): AppEnv {
  const { env, warnings } = parseEnv(process.env);
  for (const warning of warnings) console.warn(`[Env] ${warning}`);
  return env;
}

export const env: AppEnv = loadEnv();
