import { createClient } from 'redis';
import type { Server } from 'socket.io';
import mongoose from 'mongoose';
import {
  REALTIME_CHANNELS,
  SOCKET_EVENTS,
  type ResponseAcceptedEvent,
  type QuizRealtimeEvent,
} from './events';
import { verifyAccessToken } from '../utils/jwt.utils';
import { PollModel } from '../../modules/polls/polls.model';
import { QuizService } from '../../modules/quizzes/quizzes.service';
import { PresentationService } from '../../modules/presentations/presentations.service';

interface QuizJoinPayload {
  quizId?: string;
  role?: 'host' | 'participant';
  accessToken?: string;
  participantId?: string;
  participantToken?: string;
}

// Per-connection cap on join attempts — rooms are cheap but not free, and an
// unauthenticated socket should not be able to spray joins.
const MAX_JOINS_PER_MINUTE = 30;

const isValidObjectId = (id: unknown): id is string =>
  typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);

export const setupSocketAndPubSub = async (io: Server) => {
  const subscriber = createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  });

  subscriber.on('error', (error) => {
    console.error('[Redis] Subscriber Error:', error);
  });

  if (!subscriber.isOpen) {
    await subscriber.connect();
  }

  io.on('connection', (socket) => {
    let joinCount = 0;
    let joinWindowStart = Date.now();

    const allowJoin = () => {
      const now = Date.now();
      if (now - joinWindowStart > 60_000) {
        joinWindowStart = now;
        joinCount = 0;
      }
      joinCount += 1;
      return joinCount <= MAX_JOINS_PER_MINUTE;
    };

    socket.on(SOCKET_EVENTS.pollJoin, async (pollId: string) => {
      if (!isValidObjectId(pollId) || !allowJoin()) return;
      // Only published polls broadcast — draft/private polls stay unobservable.
      const poll = await PollModel.findById(pollId).select('isPublished').catch(() => null);
      if (!poll?.isPublished) return;
      socket.join(`poll_${pollId}`);
    });

    socket.on(SOCKET_EVENTS.pollLeave, (pollId: string) => {
      if (!isValidObjectId(pollId)) return;
      socket.leave(`poll_${pollId}`);
    });

    socket.on(SOCKET_EVENTS.quizJoin, async (data: QuizJoinPayload | null) => {
      if (!allowJoin()) return;
      const quizId = data?.quizId;
      if (!isValidObjectId(quizId) || !data?.role) return;

      // Quizzes and presentations live in separate collections but share this room
      // namespace and the `quiz:event` channel, so every check runs against both.
      if (data.role === 'host') {
        if (!data.accessToken) return;
        let userId: string;
        try {
          userId = (verifyAccessToken(data.accessToken) as { id: string }).id;
        } catch {
          return;
        }
        const authorized =
          (await QuizService.isOwner(quizId, userId).catch(() => false)) ||
          (await PresentationService.isOwner(quizId, userId).catch(() => false));
        if (!authorized) return;
        socket.join(`quiz_${quizId}`);
        // Host-only room: carries pre-reveal answer distributions that must
        // never reach participant sockets (see `quiz:event` subscriber below).
        socket.join(`quiz_${quizId}_host`);
        return;
      }

      if (data.role === 'participant') {
        if (!data.participantId || !data.participantToken) return;
        const authorized =
          (await QuizService.isAuthorizedParticipant(quizId, data.participantId, data.participantToken).catch(() => false)) ||
          (await PresentationService.isAuthorizedParticipant(quizId, data.participantId, data.participantToken).catch(() => false));
        if (!authorized) return;
        socket.join(`quiz_${quizId}`);
      }
    });

    socket.on(SOCKET_EVENTS.quizLeave, (quizId: string) => {
      if (!isValidObjectId(quizId)) return;
      socket.leave(`quiz_${quizId}`);
      socket.leave(`quiz_${quizId}_host`);
    });
  });

  await subscriber.subscribe(REALTIME_CHANNELS.analyticsUpdate, (payload: string) => {
    const parsed = JSON.parse(payload) as ResponseAcceptedEvent;
    io.to(`poll_${parsed.pollId}`).emit(SOCKET_EVENTS.analyticsUpdate, parsed.analytics);
  });

  await subscriber.subscribe(REALTIME_CHANNELS.quizEvent, (payload: string) => {
    const parsed = JSON.parse(payload) as QuizRealtimeEvent;
    // `answer:received` carries the live per-option/word vote distribution —
    // leaking that to participants before reveal defeats the point of a
    // scored quiz, so it only ever reaches the host-only room.
    const room =
      parsed.type === 'answer:received' ? `quiz_${parsed.quizId}_host` : `quiz_${parsed.quizId}`;
    io.to(room).emit(SOCKET_EVENTS.quizEvent, parsed);
  });
};
