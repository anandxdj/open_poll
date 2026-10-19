/**
 * Runs before any test file (bunfig.toml). `common/config/env` and the shared
 * Redis client read MONGO_URI/REDIS_URL once, on first import, so integration
 * suites can only reach the dedicated test services if the URLs are swapped
 * here, before anything imports them. Unit tests stub Mongo and Redis and
 * never connect, so the swap does not change them.
 */
if (process.env.TEST_MONGO_URI) process.env.MONGO_URI = process.env.TEST_MONGO_URI;
if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;

/**
 * A developer's backend/.env (Bun loads it for every run) must not switch real
 * integrations on under test: no real e-mail or LLM calls, no object storage,
 * no Stripe, no metrics token. A blank value counts as unset (`common/config/env`
 * `optional()`); tests that need an integration pass an explicit env source or
 * set the variable themselves.
 */
for (const key of [
  'ALLOWED_ORIGINS',
  'DOMAIN_CNAME_TARGET',
  'DOMAIN_PROVISIONER',
  'DOMAIN_VERCEL_PROJECT_ID',
  'DOMAIN_VERCEL_TEAM_ID',
  'DOMAIN_VERCEL_TOKEN',
  'ENCRYPTION_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_DRIVE_API_KEY',
  'GOOGLE_DRIVE_APP_ID',
  'GOOGLE_DRIVE_IMPORT_ENABLED',
  'GOOGLE_REDIRECT_URI',
  'GOTENBERG_URL',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'METRICS_TOKEN',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_ISSUER',
  'OIDC_REDIRECT_URI',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_NAME',
  'S3_ACCESS_KEY_ID',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'S3_PUBLIC_URL',
  'S3_REGION',
  'S3_SECRET_ACCESS_KEY',
  'SOCKET_REDIS_ADAPTER',
  'STRIPE_PRICE_PRO_MONTHLY',
  'STRIPE_PRICE_PRO_YEARLY',
  'STRIPE_PRICE_TEAM_MONTHLY',
  'STRIPE_PRICE_TEAM_YEARLY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]) {
  process.env[key] = '';
}
