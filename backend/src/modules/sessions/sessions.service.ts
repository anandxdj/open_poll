import crypto from 'crypto';
import mongoose from 'mongoose';
import { audit } from '../../common/audit/audit';
import { redisClient } from '../../common/config/redis';
import { getEntitlements } from '../../common/plans/entitlements';
import { ApiError } from '../../common/utils/ApiError';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { authorizeDeck } from '../presentations/access';
import { PresentationAnswerModel } from '../presentations/models/answer.model';
import { PresentationModel } from '../presentations/models/presentation.model';
import { PresentationParticipantModel } from '../presentations/models/participant.model';
import { PresentationSessionModel, type IPresentationSession } from '../presentations/models/session.model';
import { getSlideType, isSlideScored } from '../presentations/slides';
import { LIVE_ERROR_CODES } from '../presentations/live/contract';
import { allSessionKeys, k } from '../presentations/live/keys';
import {
  lifecycleOf,
  readSlideState,
  sessionSlides,
  slideIdOf,
  slidePhase,
  type StoredAnswerResult,
} from '../presentations/live/state';
import { buildSessionView, sessionListItem } from '../presentations/live/views';
import {
  SESSION_ERROR_CODES,
  type ReportParticipant,
  type ReportSlide,
  type SessionListResponse,
  type SessionReport,
  type TakeHome,
  type TakeHomeSlide,
} from './contract';
import { exportSlidesOf, formatAnswer, loadRankedParticipants, toStoredAnswer, type StoredAnswer } from './export/rows';
import { correctAnswerOf } from './export/summary';
import { sessionResults, standingsOf } from './results';
import { authorizeSession, canOnSession } from './sessions.access';
import type { ListSessionsQuery } from './sessions.schema';
import { isShareActive, shareView } from './share.service';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

interface Cursor {
  startedAt: Date;
  id: mongoose.Types.ObjectId;
}

export const encodeCursor = (session: Pick<IPresentationSession, 'startedAt' | '_id'>) =>
  Buffer.from(JSON.stringify({ s: session.startedAt.toISOString(), i: String(session._id) })).toString('base64url');

export const decodeCursor = (cursor: string): Cursor => {
  try {
    const { s, i } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { s?: unknown; i?: unknown };
    const startedAt = new Date(String(s));
    if (Number.isNaN(startedAt.getTime()) || typeof i !== 'string' || !mongoose.isValidObjectId(i)) throw new Error();
    return { startedAt, id: new mongoose.Types.ObjectId(i) };
  } catch {
    throw ApiError.badRequest('Invalid cursor');
  }
};

/** A deck's sessions, newest first, `limit` per page. */
export const listSessions = async (req: WorkspaceRequest, query: ListSessionsQuery): Promise<SessionListResponse> => {
  const presentation = await authorizeDeck(query.presentationId, req, 'session:read');
  const filter: Record<string, unknown> = { presentationId: presentation._id };
  if (query.cursor) {
    const { startedAt, id } = decodeCursor(query.cursor);
    filter.$or = [{ startedAt: { $lt: startedAt } }, { startedAt, _id: { $lt: id } }];
  }
  const page: IPresentationSession[] = await PresentationSessionModel.find(filter)
    .sort({ startedAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .select('-deckSnapshot -slideStats -finalLeaderboard -themeSnapshot -settingsSnapshot');
  const hasMore = page.length > query.limit;
  const sessions = page.slice(0, query.limit);

  const items = await Promise.all(
    sessions.map(async (session) => {
      // Live counts come from Redis and need the deck snapshot.
      const full = session.isLive ? await PresentationSessionModel.findById(session._id) : null;
      const item = await sessionListItem(full ?? session);
      return {
        sessionId: item.sessionId,
        presentationId: String(session.presentationId),
        runNumber: item.runNumber,
        pace: item.pace,
        status: item.status,
        isLive: item.isLive,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        participantCount: item.participantCount,
        answerCount: item.answerCount,
        retainUntil: item.retainUntil,
        shared: isShareActive(session.share),
      };
    })
  );

  return {
    presentation: { presentationId: String(presentation._id), title: presentation.title },
    items,
    nextCursor: hasMore ? encodeCursor(sessions[sessions.length - 1]!) : null,
  };
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** The snapshot slide for the StageView, without speaker notes. */
const stageSlide = (slide: Record<string, unknown>) => {
  const plain = { ...slide };
  delete plain.notes;
  return plain;
};

const answerCountsByParticipant = async (sessionId: string) => {
  const rows = await PresentationAnswerModel.aggregate<{ _id: unknown; count: number }>([
    { $match: { sessionId: new mongoose.Types.ObjectId(sessionId) } },
    { $group: { _id: '$participantId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

export const getReport = async (sessionId: string, req: WorkspaceRequest): Promise<SessionReport> => {
  const { session, presentation } = await authorizeSession(sessionId, req, 'session:read');
  const sid = String(session._id);
  const now = Date.now();

  const [results, leaderboard, answerCounts, view] = await Promise.all([
    sessionResults(session),
    standingsOf(session),
    answerCountsByParticipant(sid),
    session.isLive ? buildSessionView(session, now) : Promise.resolve(null),
  ]);
  const ranked = await loadRankedParticipants(sid, leaderboard);

  const slides: ReportSlide[] = sessionSlides(session).map((slide, index) => {
    const slideId = slideIdOf(slide);
    const def = getSlideType(slide.type);
    const lifecycle = lifecycleOf(slide.type);
    const state = readSlideState(session, slideId);
    const result = results.get(slideId);
    return {
      slideId,
      slideIndex: index,
      type: String(slide.type),
      typeName: def?.name ?? String(slide.type),
      kind: def?.kind ?? null,
      lifecycle,
      label: (def ? def.label(slide) : slide.question?.trim()) || String(slide.type),
      scored: isSlideScored(slide),
      visited: Boolean(state) || Boolean(result),
      phase: state ? slidePhase(lifecycle, state, now) : result ? 'closed' : null,
      answeredCount: result?.answeredCount ?? 0,
      distribution: result?.distribution ?? null,
      slide: stageSlide(slide as unknown as Record<string, unknown>),
    };
  });

  const participants: ReportParticipant[] = ranked.map((p) => ({
    participantId: p.participantId,
    name: p.name,
    rank: p.rank,
    score: p.score,
    correctCount: p.correctCount,
    answeredCount: answerCounts.get(p.participantId) ?? 0,
    joinedAt: p.joinedAt.toISOString(),
    kicked: p.kicked,
  }));

  const participantCount = view?.participantCount ?? session.participantCount;
  const answerCount = view?.answerCount ?? session.answerCount;
  const responseSlideCount = slides.filter((s) => s.lifecycle === 'response' && s.visited).length;
  const possible = participantCount * responseSlideCount;
  const endMs = session.endedAt ? session.endedAt.getTime() : session.isLive ? now : null;
  const features = req.workspace ? getEntitlements(req.workspace) : getEntitlements({ plan: 'free' });
  const canShare = canOnSession(req, 'session:share', presentation);

  return {
    session: {
      sessionId: sid,
      presentationId: String(session.presentationId),
      title: presentation.title,
      runNumber: session.runNumber,
      pace: session.pace,
      status: session.status,
      isLive: session.isLive,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      durationMs: endMs === null ? null : Math.max(0, endMs - session.startedAt.getTime()),
      participantCount,
      answerCount,
      responseSlideCount,
      participationRate: possible > 0 ? Math.min(1, answerCount / possible) : null,
      retainUntil: session.retainUntil ? session.retainUntil.toISOString() : null,
    },
    slides,
    leaderboard,
    participants,
    share: shareView(session.share, canShare),
    access: {
      export: canOnSession(req, 'session:export', presentation),
      share: canShare,
      delete: canOnSession(req, 'deck:delete', presentation),
    },
    exports: {
      plan: features.plan,
      csv: features.features.export_csv,
      xlsx: features.features.export_xlsx,
      pdf: features.features.export_pdf,
    },
  };
};

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Collections other modules key by session; cleaned up when present (Q&A lands with W2-B). */
const deleteSessionScopedDocuments = async (sessionId: mongoose.Types.ObjectId) => {
  const db = mongoose.connection.db;
  if (!db) return;
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  if (!names.has('qnaquestions')) return;
  const questions = db.collection('qnaquestions');
  const ids = (await questions.find({ sessionId }, { projection: { _id: 1 } }).toArray()).map((q) => q._id);
  if (ids.length && names.has('qnaupvotes')) await db.collection('qnaupvotes').deleteMany({ questionId: { $in: ids } });
  await questions.deleteMany({ sessionId });
};

/** Deletes an ended session with its participants, answers and Redis state; audited. */
export const deleteSession = async (sessionId: string, req: WorkspaceRequest) => {
  const { session } = await authorizeSession(sessionId, req, 'deck:delete');
  if (session.isLive) {
    throw new ApiError(409, 'End the session before deleting it', SESSION_ERROR_CODES.sessionLive);
  }
  const sid = String(session._id);
  const [answers, participants] = await Promise.all([
    PresentationAnswerModel.deleteMany({ sessionId: session._id }),
    PresentationParticipantModel.deleteMany({ sessionId: session._id }),
  ]);
  await deleteSessionScopedDocuments(session._id);
  await PresentationSessionModel.deleteOne({ _id: session._id });
  const keys = allSessionKeys(sid, sessionSlides(session).map(slideIdOf));
  await redisClient.del(keys).catch(() => {});

  void audit(req, 'session.delete', { type: 'session', id: sid }, {
    presentationId: String(session.presentationId),
    runNumber: session.runNumber,
    participants: participants.deletedCount ?? 0,
    answers: answers.deletedCount ?? 0,
  });
  return { sessionId: sid, deleted: true };
};

// ---------------------------------------------------------------------------
// Participant take-home
// ---------------------------------------------------------------------------

/** Constant-time comparison of a presented secret with the stored one. */
export const secretsMatch = (stored: string, presented: string) => {
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  if (a.length !== b.length) {
    // Same work either way, so the length is not timed out of the secret.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
};

/** A live session's answers not yet written behind to Mongo, from the Redis results hashes. */
const pendingLiveAnswers = async (
  sessionId: string,
  participantId: string,
  slideIds: string[]
): Promise<StoredAnswer[]> => {
  const raw = await Promise.all(
    slideIds.map((slideId) => redisClient.hGet(k.results(sessionId, slideId), participantId).catch(() => null))
  );
  return raw.flatMap((json, i) => {
    if (!json) return [];
    try {
      const result = JSON.parse(json) as StoredAnswerResult;
      return [
        toStoredAnswer({
          participantId,
          slideId: slideIds[i],
          optionIndex: result.optionIndex,
          text: result.text,
          payload: result.payload,
          isCorrect: result.isCorrect,
          score: result.score,
          timeMs: result.timeMs,
          createdAt: result.answeredAt ? new Date(result.answeredAt) : null,
        }),
      ];
    } catch {
      return [];
    }
  });
};

/**
 * A participant's place in the standings: the same order the report and the
 * exports use (score, then the leaderboard's own order, then join order),
 * counted in Mongo so a large session is not loaded for one participant.
 */
const rankOf = async (
  session: IPresentationSession,
  participant: { _id: mongoose.Types.ObjectId; score: number; joinedAt: Date }
): Promise<number> => {
  const standings = await standingsOf(session);
  const own = standings.find((entry) => entry.participantId === String(participant._id));
  if (own) return own.rank;
  // Outside the top 100: everyone with a higher score, plus equal scores that rank first.
  const ahead = await PresentationParticipantModel.countDocuments({
    sessionId: session._id,
    $or: [
      { score: { $gt: participant.score } },
      { score: participant.score, _id: { $in: standings.map((entry) => new mongoose.Types.ObjectId(entry.participantId)) } },
      { score: participant.score, joinedAt: { $lt: participant.joinedAt } },
      { score: participant.score, joinedAt: participant.joinedAt, _id: { $lt: participant._id } },
    ],
  });
  return ahead + 1;
};

/**
 * A participant's own results: every response slide shown, their answer,
 * correctness and points, and their rank. Correctness waits until the slide
 * stopped accepting answers; correct answers until the session ended or the
 * slide was revealed, so a live session leaks nothing.
 */
export const getTakeHome = async (sessionId: string, participantId: string, token: string): Promise<TakeHome> => {
  const notFound = () => ApiError.notFound('Session or participant not found');
  if (!mongoose.isValidObjectId(sessionId)) throw notFound();
  const session = await PresentationSessionModel.findById(sessionId);
  if (!session) throw notFound();
  const participant = await PresentationParticipantModel.findOne({ _id: participantId, sessionId: session._id }).lean();
  if (!participant) throw notFound();
  if (!secretsMatch(participant.token, token)) throw ApiError.unauthorized('Invalid participant token');
  if (participant.kickedAt) {
    throw new ApiError(403, 'You were removed from this session', LIVE_ERROR_CODES.participantKicked);
  }
  const presentation = await PresentationModel.findById(session.presentationId).select('title deletedAt').lean();
  if (!presentation || presentation.deletedAt) throw notFound();

  const sid = String(session._id);
  const slides = exportSlidesOf(session);
  const stored = await PresentationAnswerModel.find({ sessionId: session._id, participantId: participant._id })
    .select('participantId slideId optionIndex text payload isCorrect score timeMs createdAt')
    .lean();
  const answers = new Map(stored.filter((a) => a.slideId).map((a) => [String(a.slideId), toStoredAnswer(a)]));
  if (session.isLive) {
    const missing = slides.map((s) => s.slideId).filter((id) => !answers.has(id));
    for (const answer of await pendingLiveAnswers(sid, String(participant._id), missing)) {
      answers.set(answer.slideId, answer);
    }
  }

  const results = await sessionResults(session);
  const now = Date.now();
  const takeHomeSlides: TakeHomeSlide[] = slides.map((slide) => {
    const answer = answers.get(slide.slideId) ?? null;
    const phase = slidePhase(lifecycleOf(slide.type), readSlideState(session, slide.slideId), now);
    const settled = !session.isLive || phase !== 'open';
    const revealed = !session.isLive || phase === 'revealed';
    const graded = slide.scored && answer !== null && settled;
    return {
      slideId: slide.slideId,
      slideIndex: slide.slideIndex,
      type: slide.type,
      label: slide.label,
      scored: slide.scored,
      answered: answer !== null,
      answer: formatAnswer(slide, answer),
      isCorrect: graded ? answer!.isCorrect : null,
      points: graded ? answer!.score : null,
      timeMs: answer ? answer.timeMs : null,
      correctAnswer: slide.scored && revealed ? correctAnswerOf(results.get(slide.slideId)?.distribution) : null,
    };
  });

  const [rank, participantCount] = await Promise.all([
    rankOf(session, participant),
    session.isLive
      ? PresentationParticipantModel.countDocuments({ sessionId: session._id })
      : Promise.resolve(session.participantCount),
  ]);

  return {
    session: {
      sessionId: sid,
      title: presentation.title,
      runNumber: session.runNumber,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      participantCount,
    },
    me: {
      participantId: String(participant._id),
      name: participant.name,
      score: participant.score,
      correctCount: participant.correctCount,
      rank,
      answeredCount: [...answers.keys()].filter((slideId) => slides.some((s) => s.slideId === slideId)).length,
    },
    slides: takeHomeSlides,
  };
};
