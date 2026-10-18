import { PollModel } from '../../modules/polls/polls.model';
import { REALTIME_CHANNELS, SOCKET_EVENTS, type ResponseAcceptedEvent } from './events';
import { registerSocketModule } from './registry';
import { allowJoin, isValidObjectId, pollRoom } from './rooms';

// Poll analytics: the creator dashboard joins `poll_{pollId}` and receives
// `analytics:update` after each analytics-worker flush.
export const pollsSocketModule = registerSocketModule({
  name: 'polls',

  onConnection(socket) {
    socket.on(SOCKET_EVENTS.pollJoin, async (pollId: unknown) => {
      if (!isValidObjectId(pollId) || !allowJoin(socket)) return;
      // Only published polls broadcast — draft/private polls stay unobservable.
      const poll = await PollModel.findById(pollId).select('isPublished').catch(() => null);
      if (!poll?.isPublished) return;
      socket.join(pollRoom(pollId));
    });

    socket.on(SOCKET_EVENTS.pollLeave, (pollId: unknown) => {
      if (!isValidObjectId(pollId)) return;
      socket.leave(pollRoom(pollId));
    });
  },

  channels: {
    [REALTIME_CHANNELS.analyticsUpdate]: (message, io) => {
      const parsed = JSON.parse(message) as ResponseAcceptedEvent;
      if (!isValidObjectId(parsed?.pollId)) return;
      io.local.to(pollRoom(parsed.pollId)).emit(SOCKET_EVENTS.analyticsUpdate, parsed.analytics);
    },
  },
});
