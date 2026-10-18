---
summary: Fire-and-forget audit events with plan-based TTL, and AES-256-GCM encryption of secrets at rest.
status: active
last_updated: 2026-10-19
---

# Audit events and secret encryption

## Audit (`common/audit/audit.ts`, `modules/audit/audit.model.ts`)

```ts
void audit(req, 'media.upload', { type: 'media', id: asset._id }, { bytes });
void audit({ actorType: 'system' | 'scim' | 'api', actorId?, workspace?, ip?, ua? }, action, target, meta);
```

- Fire-and-forget: never throws, never blocks the response; failures are logged. The returned
  promise always fulfils (await it only in scripts/tests).
- From a request: actor = `req.user` (`actorType: 'user'`, else `system`), workspace =
  `req.workspace`, plus `req.ip` and the user agent (≤512 chars).
- Actions are dotted verbs: `media.upload`, `workspace.plan.set`, … The UI (W3-B1) lists by
  `{workspaceId, createdAt: -1}`.
- `AuditEvent {workspaceId, actorId, actorType: user|scim|system|api, action, targetType,
  targetId (string), ip, ua, meta, expiresAt, createdAt}`. `expiresAt` = now + the plan's
  `auditRetentionDays` (free plan's value without a workspace); `null` (unlimited) keeps it.
  TTL index on `expiresAt`.

## Secrets at rest (`common/utils/crypto.ts`)

```ts
encryptSecret(plaintext, associatedData?)   // 'v1.<iv>.<tag>.<ciphertext>' (base64url parts)
decryptSecret(payload, associatedData?)     // throws on wrong key, wrong AAD or tampering
isEncryptionConfigured()
```

- AES-256-GCM, fresh 96-bit IV per call, key `ENCRYPTION_KEY` (32 bytes: `openssl rand -hex
  32`, or base64). Without it both throw `EncryptionUnavailableError` and the `samlSso`/`scim`
  capabilities are off.
- Pass the owning record's id as associated data (e.g. `sso:<connectionId>`) so a ciphertext
  copied onto another record does not decrypt.
- Rotating the key makes stored values unreadable; re-encrypt before switching.
