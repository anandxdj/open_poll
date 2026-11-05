---
summary: Builder presence socket contract (deck:join, deck:leave, presence:update), its room, Redis hash and channel — W3-B2.
status: active
last_updated: 2026-11-05
---

# Builder presence (`modules/presentations/editor.socket.ts`)

Who else has a deck open in the builder. Informational only: overlapping saves are refused by the
deck revision (`If-Match`, `modules/folders-templates.md` → Co-editing), not by presence. Presence is
not a live event (editors are not in a session's rooms), so it has its own socket events and channel
(`common/realtime/events/editor.ts`), registered as the `editor` socket module.

| Event | Direction | Payload | Notes |
| --- | --- | --- | --- |
| `deck:join` | client → server, with ack | `{ presentationId, accessToken? }` | Needs `deck:edit` on the deck (shares count; checked on every call). Ack `{ ok: true, editors }` or `{ ok: false, error: 'INVALID_PAYLOAD' \| 'RATE_LIMITED' \| 'UNAUTHENTICATED' \| 'FORBIDDEN' \| 'UNAVAILABLE' }`. Resend every ~30 s as a heartbeat (does not spend the join budget once joined). The token in the payload wins over the handshake identity. |
| `deck:leave` | client → server | `{ presentationId }` | Also implied by disconnecting. |
| `presence:update` | server → room `editor:{presentationId}` | `{ presentationId, editors }` | Sent when someone opens the deck (first join of a socket) or leaves it. |

```ts
editors: { userId, name, since /* ISO, first open */, tabs /* that user's open builders */ }[]  // one per user, earliest first
```

- **State**: Redis hash `editor:{presentationId}:presence`, field = socket id, value
  `{userId, name, since, at}`; 3-minute TTL refreshed by every heartbeat. Entries without a heartbeat
  for 75 s are dropped when the hash is read (a crashed instance never sent their disconnect).
- **Fan-out**: a join or leave publishes `{presentationId}` on `editor:presence`; every instance reads
  the hash and emits `presence:update` to its own sockets in the room with `io.local` (never `io.to`).
- **Frontend**: `features/presentations/components/builder/useDeckPresence.ts` and `PresenceAvatars.tsx`
  (`frontend/docs/wiki/features/presentation-builder.md`).
- **Tests**: `tests/integration/presence.test.ts` (real sockets and Redis), `tests/realtime.modules.test.ts`
  (registration), `frontend/e2e/coediting.spec.ts` (the "another tab" note appears and goes).
