import type { Server } from 'socket.io';
import { registerSocketModule } from '../../common/realtime/registry';
import { isValidObjectId, leavePresentationRooms, liveRooms } from '../../common/realtime/rooms';
import { screenTokensOf } from './screenSockets';
import { SCREEN_REVOKED_CHANNEL, type ScreenRevokeReason } from './screenTokens.service';

/** Sent to a screen whose token was revoked, after it left the deck's rooms. */
export const SCREEN_REVOKED_EVENT = 'screen:revoked';

/**
 * Screens stop at once (W4-D) when their token is revoked or the deck stops
 * allowing embedding: every instance hears `embeds:screen-revoked` and removes
 * its own sockets that joined the deck with that token (or, without a token,
 * every screen of the deck) from the deck's rooms, then tells them why
 * (`screen:revoked {presentationId, reason}`). The next join or resync is
 * refused anyway.
 */
export const handleScreenRevoked = async (message: string, io: Server) => {
  let parsed: { tokenId?: unknown; presentationId?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(message);
  } catch {
    return;
  }
  const { tokenId, presentationId } = parsed;
  if (!isValidObjectId(presentationId) || (tokenId !== undefined && typeof tokenId !== 'string')) return;
  const reason: ScreenRevokeReason = parsed.reason === 'embed_disabled' ? 'embed_disabled' : 'revoked';
  const sockets = await io.local.in(liveRooms.screen(presentationId)).fetchSockets();
  for (const remote of sockets) {
    const socket = io.sockets.sockets.get(remote.id);
    const joinedWith = socket ? screenTokensOf(socket).get(presentationId) : undefined;
    if (!socket || !joinedWith || (tokenId !== undefined && joinedWith !== tokenId)) continue;
    screenTokensOf(socket).delete(presentationId);
    leavePresentationRooms(socket, presentationId);
    socket.emit(SCREEN_REVOKED_EVENT, { presentationId, reason });
  }
};

export const embedsSocketModule = registerSocketModule({
  name: 'embeds',
  channels: {
    [SCREEN_REVOKED_CHANNEL]: (message, io) => {
      handleScreenRevoked(message, io).catch((error) => console.error('[Embeds] Screen revoke delivery failed:', error));
    },
  },
});
