// ---------- Builder presence (modules/presentations/editor.socket.ts, W3-B2) ----------
// Not live events: editors are not in a session's rooms, so presence has its own
// Redis channel and socket event instead of the live envelope.

export const EDITOR_SOCKET_EVENTS = {
  // Client → server: `{presentationId, accessToken?}` with an ack `{ok, editors}`; resend every ~30 s as a heartbeat.
  deckJoin: 'deck:join',
  // Client → server: `{presentationId}` (also implied by disconnecting).
  deckLeave: 'deck:leave',
  // Server → editors of a deck: `{presentationId, editors: [{userId, name, since}]}`.
  presenceUpdate: 'presence:update',
} as const;

/** Redis channel telling every instance that a deck's editors changed: `{presentationId}`. */
export const EDITOR_PRESENCE_CHANNEL = 'editor:presence';
