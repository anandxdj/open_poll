import { createClient } from 'redis';
import type { Server } from 'socket.io';
import mongoose from 'mongoose';
import {
  REALTIME_CHANNELS,
  SOCKET_EVENTS,
  type ResponseAcceptedEvent,
  type QuizRealtimeEvent,
} from './events';
import { PollModel } from '../../modules/polls/polls.model';
import { QuizModel } from '../../modules/quizzes/quizzes.model';
import { PresentationModel } from '../../modules/presentations/presentations.model';

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

    socket.on(SOCKET_EVENTS.quizJoin, async (quizId: string) => {
      if (!isValidObjectId(quizId) || !allowJoin()) return;
      // Draft quizzes/presentations are creator-private; anything in session is
      // joinable — participants hold no auth, and broadcasts are answer-key-sanitized.
      // Quizzes and presentations live in separate collections but share this room
      // namespace and the `quiz:event` channel, so check both.
      const quiz = await QuizModel.findById(quizId).select('status').catch(() => null);
      if (quiz) {
        if (quiz.status === 'draft') return;
        socket.join(`quiz_${quizId}`);
        return;
      }
      const presentation = await PresentationModel.findById(quizId).select('status').catch(() => null);
      if (!presentation || presentation.status === 'draft') return;
      socket.join(`quiz_${quizId}`);
    });

    socket.on(SOCKET_EVENTS.quizLeave, (quizId: string) => {
      if (!isValidObjectId(quizId)) return;
      socket.leave(`quiz_${quizId}`);
    });
  });

  await subscriber.subscribe(REALTIME_CHANNELS.analyticsUpdate, (payload: string) => {
    const parsed = JSON.parse(payload) as ResponseAcceptedEvent;
    io.to(`poll_${parsed.pollId}`).emit(SOCKET_EVENTS.analyticsUpdate, parsed.analytics);
  });

  await subscriber.subscribe(REALTIME_CHANNELS.quizEvent, (payload: string) => {
    const parsed = JSON.parse(payload) as QuizRealtimeEvent;
    io.to(`quiz_${parsed.quizId}`).emit(SOCKET_EVENTS.quizEvent, parsed);
  });
};
