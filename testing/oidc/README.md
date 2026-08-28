# OIDC integration tests

These tests exercise the running OpenPoll backend and the real `id` discovery,
authorization, and token endpoints. They never print or embed the client secret.

Start the local stack and run:

```powershell
docker compose up -d --build
bun test testing/oidc/oidc.integration.test.ts
```

The automated suite verifies the generated S256 authorization request, provider
acceptance of the registered client/redirect, state mismatch rejection, redirect
URI mismatch rejection, and wrong-secret rejection.

A true bad-PKCE test requires a genuine, unconsumed authorization code. Run the
interactive sign-in, then substitute an incorrect verifier only in a disposable
test environment; authorization codes are single-use and the failed exchange
will consume or invalidate the code.
