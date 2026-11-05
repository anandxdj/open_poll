import type { Server } from 'socket.io';
import { registerSocketModule } from '../../common/realtime/registry';
import { isValidObjectId, leavePresentationRooms, liveRooms } from '../../common/realtime/rooms';
import { screenTokensOf } from './screenSockets';
import { SCREEN_REVOKED_CHANNEL } from './screenTokens.service';

/** Sent to a screen whose token was revoked, after it left the deck's rooms. */
export const SCREEN_REVOKED_EVENT = 'screen:revoked';

/**
 * A revoked screen token (W4-D) stops working at once: every instance hears
 * `embeds:screen-revoked` and removes its own sockets that joined the deck
 * with that token from the deck's rooms, then tells them. The next join or
 * resync with the token is refused anyway.
 */
export const handleScreenRevoked = async (message: string, io: Server) => {
  let parsed: { tokenId?: unknown; presentationId?: unknown };
  try {
    parsed = JSON.parse(message);
  } catch {
    return;
  }
  const { tokenId, presentationId } = parsed;
  if (typeof tokenId !== 'string' || !isValidObjectId(presentationId)) return;
  const sockets = await io.local.in(liveRooms.screen(presentationId)).fetchSockets();
  for (const remote of sockets) {
    const socket = io.sockets.sockets.get(remote.id);
    if (!socket || screenTokensOf(socket).get(presentationId) !== tokenId) continue;
    screenTokensOf(socket).delete(presentationId);
    leavePresentationRooms(socket, presentationId);
    socket.emit(SCREEN_REVOKED_EVENT, { presentationId });
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
