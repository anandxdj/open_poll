import { SOCKET_EVENTS } from '../../common/realtime/events';
import { registerSocketModule } from '../../common/realtime/registry';
import { registerScreenView } from '../../common/realtime/screenViews';
import { sendReaction, type ReactionAck, type ReactionSendPayload } from './reactions.service';

/**
 * `reaction:send {presentationId, participantId, participantToken, emoji}` with
 * an optional ack (`{ok: true}` or `{ok: false, error}`). The participant token
 * is checked on the first send and cached for the socket; the stage receives
 * the coalesced `reaction:burst` through the live envelope.
 */
// Emoji counts float up every stage, the host console's and the read-only screens' (W4-D).
registerScreenView('reaction:burst', (payload) => payload);

export const reactionsSocketModule = registerSocketModule({
  name: 'reactions',

  onConnection(socket) {
    socket.on(SOCKET_EVENTS.reactionSend, async (data: ReactionSendPayload | null, ack?: unknown) => {
      const result: ReactionAck = await sendReaction(socket, data);
      if (typeof ack === 'function') ack(result);
    });
  },
});
