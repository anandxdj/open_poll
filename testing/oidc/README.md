# OIDC integration tests

These tests exercise the running OpenPoll backend and the real `id` discovery,
authorization, and token endpoints. They never print or embed the client secret.

## Configuration

The suite reads the relying-party settings from the environment and is skipped
(with a warning naming the missing variables) when they are unset. Each value
must match what the running backend uses, so the `OIDC_*` backend variables are
accepted as fallbacks:

| Variable | Fallback | Example |
| --- | --- | --- |
| `OIDC_TEST_ISSUER` | `OIDC_ISSUER` | `https://id-backend.anands.dev` |
| `OIDC_TEST_CLIENT_ID` | `OIDC_CLIENT_ID` | the client id registered with the IdP |
| `OIDC_TEST_REDIRECT_URI` | `OIDC_REDIRECT_URI` | `http://localhost:3000/api/auth/callback/id` |
| `OIDC_TEST_BACKEND` (optional) | – | defaults to `http://localhost:5000` |
| `OIDC_TEST_LOGIN_URL` (optional) | – | `https://id.anands.dev/login`; when set, the IdP's unauthenticated redirect must go there |

The redirect URI must be registered with the IdP and must reach the backend
callback (`/auth/callback`, `/api/auth/callback`, or the Next.js dev relay
`/api/auth/callback/id`); see `backend/.env.example`.

## Running

Start the local stack and run:

```powershell
docker compose up -d --build
$env:OIDC_TEST_ISSUER = "https://id-backend.anands.dev"
$env:OIDC_TEST_CLIENT_ID = "<client id>"
$env:OIDC_TEST_REDIRECT_URI = "http://localhost:3000/api/auth/callback/id"
bun test testing/oidc/oidc.integration.test.ts
```

```bash
OIDC_TEST_ISSUER=https://id-backend.anands.dev \
OIDC_TEST_CLIENT_ID=<client id> \
OIDC_TEST_REDIRECT_URI=http://localhost:3000/api/auth/callback/id \
bun test testing/oidc/oidc.integration.test.ts
```

The automated suite verifies the generated S256 authorization request, provider
acceptance of the registered client/redirect, that the `oidc_state` cookie is
scoped to `/` (so every callback path receives it), state mismatch rejection on
both callback paths, redirect URI mismatch rejection, and wrong-secret rejection.
Failed browser sign-ins redirect to `/login?error=<code>` (for example
`sso_failed`), never to a JSON error page.

A true bad-PKCE test requires a genuine, unconsumed authorization code. Run the
interactive sign-in, then substitute an incorrect verifier only in a disposable
test environment; authorization codes are single-use and the failed exchange
will consume or invalidate the code.
