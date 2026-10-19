import mongoose from 'mongoose';
import { publishLiveEvent } from '../../common/realtime/publish';
import type { LiveAudience } from '../../common/realtime/events';
import { ApiError } from '../../common/utils/ApiError';
import { authorizeDeck, type Actor } from '../presentations/access';
import { LIVE_ERROR_CODES, type DeckSettings } from '../presentations/live/contract';
import { findLatestSession, findLiveSession } from '../presentations/live/state';
import { PresentationModel } from '../presentations/models/presentation.model';
import { PresentationParticipantModel } from '../presentations/models/participant.model';
import { PresentationSessionModel } from '../presentations/models/session.model';
import { DEFAULT_REACTION_EMOJIS, MAX_REACTION_EMOJIS } from '../presentations/models/presentation.model';
import { setCoalescer } from './coalescer';
import {
  QNA_ERROR_CODES,
  QNA_PUBLIC_STATUSES,
  isPublicStatus,
  type QnaEventPayloads,
  type QnaHostListResponse,
  type QnaHostQuestion,
  type QnaParticipantListResponse,
  type QnaParticipantQuestion,
  type QnaQuestionView,
  type QnaSettingsView,
  type QnaUpvoteResponse,
  type ReactionSettingsView,
} from './qna.contract';
import { QNA_KEY_TTL_SEC, qnaKeys } from './qna.keys';
import { QnaQuestionModel, QnaUpvoteModel, type IQnaQuestion } from './qna.model';
import { maskProfanity } from './profanity';
import type { AskQuestionInput, HostListStatus, HostUpdateQuestionInput } from './qna.schema';

/** The slide type whose `board` lifecycle opens Q&A while it is on screen. */
export const QNA_SLIDE_TYPE = 'qna';

/** A participant as the token proved it (`participantAuth`). */
export interface QnaParticipant {
  id: string;
  sessionId: string;
}

const PARTICIPANT_LIST_LIMIT = 300;
const HOST_LIST_LIMIT = 500;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type Settings = Partial<Pick<DeckSettings, 'qna' | 'reactions'>> | null | undefined;

/** Deck Q&A settings with the model defaults filled in (snapshots of older decks may lack them). */
export const qnaSettingsOf = (settings: Settings) => {
  const qna: Partial<DeckSettings['qna']> = settings?.qna ?? {};
  return {
    enabled: qna.enabled ?? false,
    moderation: qna.moderation ?? false,
    anonymousAllowed: qna.anonymousAllowed ?? true,
    upvotes: qna.upvotes ?? true,
  };
};

export const reactionSettingsOf = (settings: Settings): ReactionSettingsView => {
  const reactions: Partial<DeckSettings['reactions']> = settings?.reactions ?? {};
  const emojis = Array.isArray(reactions.emojis) ? reactions.emojis : DEFAULT_REACTION_EMOJIS;
  return {
    enabled: reactions.enabled ?? false,
    emojis: emojis.filter((e): e is string => typeof e === 'string' && e.length > 0).slice(0, MAX_REACTION_EMOJIS),
  };
};

// ---------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------

export interface SessionContext {
  sessionId: string;
  presentationId: string;
  workspaceId: mongoose.Types.ObjectId | null;
  isLive: boolean;
  /** The Q&A slide on screen, if any. */
  qnaSlideId: string | null;
  /** The deck snapshot has a Q&A slide. */
  hasBoard: boolean;
  settings: Settings;
}

type SessionLean = {
  _id: mongoose.Types.ObjectId;
  presentationId: mongoose.Types.ObjectId;
  workspaceId?: mongoose.Types.ObjectId | null;
  status: string;
  isLive: boolean;
  currentSlideId?: mongoose.Types.ObjectId | null;
  settingsSnapshot?: Settings;
  deckSnapshot?: { _id?: mongoose.Types.ObjectId; type?: string }[];
};

const SESSION_FIELDS = 'presentationId workspaceId status isLive currentSlideId settingsSnapshot deckSnapshot._id deckSnapshot.type';

const toContext = async (session: SessionLean): Promise<SessionContext> => {
  let settings = session.settingsSnapshot ?? null;
  if (!settings) {
    // Sessions from before settings snapshots (migration 030) run on the deck's settings.
    const deck = await PresentationModel.findById(session.presentationId).select('settings').lean();
    settings = (deck?.settings as Settings) ?? null;
  }
  const currentId = session.currentSlideId ? String(session.currentSlideId) : null;
  const current =
    session.status === 'active' && currentId
      ? (session.deckSnapshot ?? []).find((slide) => String(slide._id) === currentId)
      : undefined;
  return {
    sessionId: String(session._id),
    presentationId: String(session.presentationId),
    workspaceId: session.workspaceId ?? null,
    isLive: Boolean(session.isLive) && session.status !== 'ended',
    qnaSlideId: current?.type === QNA_SLIDE_TYPE ? currentId : null,
    hasBoard: (session.deckSnapshot ?? []).some((slide) => slide.type === QNA_SLIDE_TYPE),
    settings,
  };
};

/** A session's Q&A/reaction context (settings, live flag, Q&A slide on screen); null when missing. */
export const loadSessionContext = async (sessionId: string): Promise<SessionContext | null> => {
  if (!mongoose.isValidObjectId(sessionId)) return null;
  const session = await PresentationSessionModel.findById(sessionId).select(SESSION_FIELDS).lean<SessionLean>();
  return session ? toContext(session) : null;
};

/** The participant's session; 404 when it is not this deck's. */
const participantSession = async (presentationId: string, participant: QnaParticipant) => {
  const ctx = await loadSessionContext(participant.sessionId);
  if (!ctx || ctx.presentationId !== presentationId) {
    throw ApiError.notFound('Participant not found — rejoin the presentation deck');
  }
  return ctx;
};

/** What participants may do now, from the session's settings and the slide on screen. */
export const settingsView = (
  ctx: Pick<SessionContext, 'isLive' | 'qnaSlideId' | 'hasBoard' | 'settings'>
): QnaSettingsView => {
  const qna = qnaSettingsOf(ctx.settings);
  const onBoard = ctx.isLive && ctx.qnaSlideId !== null;
  return { ...qna, open: ctx.isLive && (qna.enabled || onBoard), onBoard, hasBoard: ctx.hasBoard };
};

const staleError = () =>
  new ApiError(409, 'This session has ended — rejoin to take part', LIVE_ERROR_CODES.participantStale);

/** Throws unless participants may ask/upvote in this session right now. */
const assertOpen = (ctx: SessionContext): QnaSettingsView => {
  if (!ctx.isLive) throw staleError();
  const view = settingsView(ctx);
  if (!view.open) throw new ApiError(403, 'Q&A is not open for this presentation', QNA_ERROR_CODES.disabled);
  return view;
};

// ---------------------------------------------------------------------------
// Views and events
// ---------------------------------------------------------------------------

type QuestionLean = Pick<
  IQnaQuestion,
  | '_id'
  | 'sessionId'
  | 'slideId'
  | 'participantId'
  | 'text'
  | 'authorName'
  | 'anonymous'
  | 'status'
  | 'pinned'
  | 'upvoteCount'
  | 'createdAt'
  | 'answeredAt'
  | 'highlightedAt'
  | 'presentationId'
>;

const iso = (date: Date | null | undefined) => (date ? new Date(date).toISOString() : null);

/** The public view: never the author's participant id, no name when anonymous. */
export const toQuestionView = (q: QuestionLean): QnaQuestionView => ({
  id: String(q._id),
  sessionId: String(q.sessionId),
  slideId: q.slideId ? String(q.slideId) : null,
  text: q.text,
  authorName: q.anonymous ? null : (q.authorName ?? null),
  anonymous: Boolean(q.anonymous),
  status: q.status,
  pinned: Boolean(q.pinned),
  upvoteCount: Math.max(0, q.upvoteCount ?? 0),
  createdAt: iso(q.createdAt) ?? new Date(0).toISOString(),
  answeredAt: iso(q.answeredAt),
});

const toHostQuestion = (q: QuestionLean, highlighted = Boolean(q.highlightedAt)): QnaHostQuestion => ({
  ...toQuestionView(q),
  participantId: q.anonymous ? null : String(q.participantId),
  highlighted,
});

const publish = <T extends keyof QnaEventPayloads>(
  presentationId: string,
  sessionId: string,
  type: T,
  payload: QnaEventPayloads[T],
  audience: LiveAudience
) =>
  publishLiveEvent({
    presentationId,
    sessionId,
    type,
    payload: payload as unknown as Record<string, unknown>,
    audience,
  });

/**
 * `qna:updated`: everyone when participants saw the question before or see it
 * now; otherwise (pending ↔ rejected/archived) only the host and the author.
 */
const publishUpdated = async (presentationId: string, prevStatus: IQnaQuestion['status'], next: QuestionLean) => {
  const question = toQuestionView(next);
  const sessionId = String(next.sessionId);
  if (isPublicStatus(prevStatus) || isPublicStatus(next.status)) {
    await publish(presentationId, sessionId, 'qna:updated', { question }, 'all');
    return;
  }
  await publish(presentationId, sessionId, 'qna:updated', { question }, 'host');
  await publish(presentationId, sessionId, 'qna:updated', { question }, `participant:${String(next.participantId)}`);
};

/** Coalesced `qna:votes` for one session: at most one event per 500 ms, read from Mongo when it fires. */
const markVotesChanged = (presentationId: string, sessionId: string, questionId: string) =>
  setCoalescer({
    keys: { data: qnaKeys.votesDirty(sessionId), lock: qnaKeys.votesLock(sessionId) },
    ttlSec: QNA_KEY_TTL_SEC,
    flush: async (ids) => {
      const questions = await QnaQuestionModel.find({
        _id: { $in: ids.filter((id) => mongoose.isValidObjectId(id)) },
        sessionId,
        status: { $in: QNA_PUBLIC_STATUSES },
      })
        .select('upvoteCount')
        .lean();
      if (questions.length === 0) return;
      await publish(
        presentationId,
        sessionId,
        'qna:votes',
        { votes: questions.map((q) => ({ id: String(q._id), upvoteCount: Math.max(0, q.upvoteCount ?? 0) })) },
        'all'
      );
    },
  })
    .mark(questionId)
    .catch((error) => console.error('[Q&A] Failed to schedule qna:votes:', error));

// ---------------------------------------------------------------------------
// Participant actions
// ---------------------------------------------------------------------------

const participantName = async (sessionId: string, participantId: string) => {
  const participant = await PresentationParticipantModel.findOne({ _id: participantId, sessionId }).select('name').lean();
  return participant?.name ?? null;
};

const highlightedQuestion = (sessionId: string) =>
  QnaQuestionModel.findOne({ sessionId, highlightedAt: { $ne: null }, status: { $in: QNA_PUBLIC_STATUSES } })
    .sort({ highlightedAt: -1 })
    .lean<QuestionLean>();

/** `POST /qna`: a new question, `pending` under moderation, else visible to everyone at once. */
export const askQuestion = async (
  presentationId: string,
  participant: QnaParticipant,
  input: AskQuestionInput
): Promise<QnaParticipantQuestion> => {
  const ctx = await participantSession(presentationId, participant);
  const view = assertOpen(ctx);
  if (input.anonymous && !view.anonymousAllowed) {
    throw new ApiError(403, 'This presentation does not take anonymous questions', QNA_ERROR_CODES.anonymousDisabled);
  }
  const authorName = input.anonymous ? null : await participantName(ctx.sessionId, participant.id);

  const created = await QnaQuestionModel.create({
    presentationId,
    workspaceId: ctx.workspaceId,
    sessionId: ctx.sessionId,
    slideId: ctx.qnaSlideId,
    participantId: participant.id,
    authorName,
    anonymous: input.anonymous,
    text: maskProfanity(input.text),
    status: view.moderation ? 'pending' : 'visible',
  });

  const question = toQuestionView(created);
  // Pending questions reach the host only; the author has the response.
  await publish(presentationId, ctx.sessionId, 'qna:question', { question }, question.status === 'visible' ? 'all' : 'host');
  return { ...question, mine: true, upvoted: false };
};

/** `GET /qna`: visible and answered questions, plus the caller's own pending ones. */
export const listForParticipant = async (
  presentationId: string,
  participant: QnaParticipant
): Promise<QnaParticipantListResponse> => {
  const ctx = await participantSession(presentationId, participant);
  const me = new mongoose.Types.ObjectId(participant.id);
  const [questions, upvotes, highlighted] = await Promise.all([
    QnaQuestionModel.find({
      sessionId: ctx.sessionId,
      $or: [{ status: { $in: QNA_PUBLIC_STATUSES } }, { participantId: me, status: 'pending' }],
    })
      .sort({ pinned: -1, upvoteCount: -1, createdAt: -1 })
      .limit(PARTICIPANT_LIST_LIMIT)
      .lean<QuestionLean[]>(),
    QnaUpvoteModel.find({ sessionId: ctx.sessionId, participantId: me }).select('questionId').lean(),
    highlightedQuestion(ctx.sessionId),
  ]);
  const upvoted = new Set(upvotes.map((u) => String(u.questionId)));
  return {
    sessionId: ctx.sessionId,
    qna: settingsView(ctx),
    reactions: reactionSettingsOf(ctx.settings),
    highlightedId: highlighted ? String(highlighted._id) : null,
    questions: questions.map((q) => ({
      ...toQuestionView(q),
      mine: String(q.participantId) === participant.id,
      upvoted: upvoted.has(String(q._id)),
    })),
  };
};

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/**
 * `POST|DELETE /qna/:qid/upvote`. The unique `{questionId, participantId}`
 * index is the dedup: the counter moves only when an upvote document was
 * actually inserted or deleted, so concurrent clicks count once. Repeating the
 * same call is a no-op that reports the current state.
 */
export const setUpvote = async (
  presentationId: string,
  participant: QnaParticipant,
  questionId: string,
  upvote: boolean
): Promise<QnaUpvoteResponse> => {
  const ctx = await participantSession(presentationId, participant);
  const view = assertOpen(ctx);
  if (!view.upvotes) throw new ApiError(403, 'Upvotes are off for this presentation', QNA_ERROR_CODES.upvotesDisabled);

  const question = mongoose.isValidObjectId(questionId)
    ? await QnaQuestionModel.findOne({ _id: questionId, sessionId: ctx.sessionId })
        .select('status participantId upvoteCount')
        .lean()
    : null;
  if (!question) throw ApiError.notFound('Question not found');
  if (!isPublicStatus(question.status)) {
    throw new ApiError(409, 'This question is not visible', QNA_ERROR_CODES.notVisible);
  }
  if (String(question.participantId) === participant.id) {
    throw new ApiError(403, 'You cannot upvote your own question', QNA_ERROR_CODES.ownQuestion);
  }

  await QnaUpvoteModel.init();
  let changed = false;
  if (upvote) {
    try {
      await QnaUpvoteModel.create({
        questionId,
        participantId: participant.id,
        sessionId: ctx.sessionId,
        presentationId,
        workspaceId: ctx.workspaceId,
      });
      changed = true;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  } else {
    const removed = await QnaUpvoteModel.deleteOne({ questionId, participantId: participant.id });
    changed = removed.deletedCount === 1;
  }

  let upvoteCount = question.upvoteCount ?? 0;
  if (changed) {
    const updated = await QnaQuestionModel.findOneAndUpdate(
      { _id: questionId },
      { $inc: { upvoteCount: upvote ? 1 : -1 } },
      { returnDocument: 'after', projection: { upvoteCount: 1 } }
    ).lean();
    upvoteCount = updated?.upvoteCount ?? upvoteCount;
    void markVotesChanged(presentationId, ctx.sessionId, questionId);
  } else {
    const current = await QnaQuestionModel.findById(questionId).select('upvoteCount').lean();
    upvoteCount = current?.upvoteCount ?? upvoteCount;
  }
  return { questionId, upvoted: upvote, upvoteCount: Math.max(0, upvoteCount) };
};

// ---------------------------------------------------------------------------
// Host moderation
// ---------------------------------------------------------------------------

/** `GET /host/qna?status=`: the live session's questions (else the latest session's). */
export const listForHost = async (
  presentationId: string,
  actor: Actor,
  status: HostListStatus
): Promise<QnaHostListResponse> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = (await findLiveSession(presentationId)) ?? (await findLatestSession(presentationId));
  if (!session) {
    return {
      sessionId: null,
      qna: { ...qnaSettingsOf(presentation.settings), open: false, onBoard: false, hasBoard: false },
      highlightedId: null,
      questions: [],
    };
  }
  const ctx = await toContext(session.toObject() as SessionLean);
  const [questions, highlighted] = await Promise.all([
    QnaQuestionModel.find({ sessionId: ctx.sessionId, ...(status === 'all' ? {} : { status }) })
      .sort({ pinned: -1, upvoteCount: -1, createdAt: -1 })
      .limit(HOST_LIST_LIMIT)
      .lean<QuestionLean[]>(),
    highlightedQuestion(ctx.sessionId),
  ]);
  return {
    sessionId: ctx.sessionId,
    qna: settingsView(ctx),
    highlightedId: highlighted ? String(highlighted._id) : null,
    questions: questions.map((q) => toHostQuestion(q, highlighted !== null && String(highlighted._id) === String(q._id))),
  };
};

const findDeckQuestion = async (presentationId: string, questionId: string) => {
  const question = mongoose.isValidObjectId(questionId)
    ? await QnaQuestionModel.findOne({ _id: questionId, presentationId }).lean<QuestionLean>()
    : null;
  if (!question) throw ApiError.notFound('Question not found');
  return question;
};

/** `PATCH /host/qna/:qid {status, pinned}`: approve, reject, answer, archive, pin. */
export const updateForHost = async (
  presentationId: string,
  actor: Actor,
  questionId: string,
  input: HostUpdateQuestionInput
): Promise<QnaHostQuestion> => {
  await authorizeDeck(presentationId, actor, 'deck:host');
  const current = await findDeckQuestion(presentationId, questionId);

  const set: Record<string, unknown> = {};
  if (input.pinned !== undefined) set.pinned = input.pinned;
  if (input.status !== undefined && input.status !== current.status) {
    set.status = input.status;
    set.answeredAt = input.status === 'answered' ? new Date() : null;
    // A question participants no longer see cannot stay over the stage.
    if (!isPublicStatus(input.status)) set.highlightedAt = null;
  }
  if (Object.keys(set).length === 0) return toHostQuestion(current);

  // One atomic write; the previous document tells which audience must hear about it.
  const before = await QnaQuestionModel.findOneAndUpdate(
    { _id: questionId, presentationId },
    { $set: set },
    { returnDocument: 'before' }
  ).lean<QuestionLean>();
  if (!before) throw ApiError.notFound('Question not found');
  const after = { ...before, ...set } as QuestionLean;

  await publishUpdated(presentationId, before.status, after);
  if (before.highlightedAt && after.highlightedAt === null) {
    await publish(presentationId, String(after.sessionId), 'qna:highlight', { question: null }, 'all');
  }
  return toHostQuestion(after);
};

/** `POST /host/qna/:qid/highlight {highlighted}`: show the question over the stage, or take it down. */
export const highlightForHost = async (
  presentationId: string,
  actor: Actor,
  questionId: string,
  highlighted: boolean
): Promise<QnaHostQuestion> => {
  await authorizeDeck(presentationId, actor, 'deck:host');
  const question = await findDeckQuestion(presentationId, questionId);
  const sessionId = String(question.sessionId);

  if (!highlighted) {
    if (!question.highlightedAt) return toHostQuestion(question);
    await QnaQuestionModel.updateOne({ _id: questionId }, { $set: { highlightedAt: null } });
    await publish(presentationId, sessionId, 'qna:highlight', { question: null }, 'all');
    return toHostQuestion({ ...question, highlightedAt: null });
  }

  if (!isPublicStatus(question.status)) {
    throw new ApiError(409, 'Approve the question before highlighting it', QNA_ERROR_CODES.notVisible);
  }
  const now = new Date();
  await QnaQuestionModel.updateMany(
    { sessionId, highlightedAt: { $ne: null }, _id: { $ne: question._id } },
    { $set: { highlightedAt: null } }
  );
  const updated = await QnaQuestionModel.findOneAndUpdate(
    { _id: questionId, status: { $in: QNA_PUBLIC_STATUSES } },
    { $set: { highlightedAt: now } },
    { returnDocument: 'after' }
  ).lean<QuestionLean>();
  if (!updated) throw new ApiError(409, 'Approve the question before highlighting it', QNA_ERROR_CODES.notVisible);
  await publish(presentationId, sessionId, 'qna:highlight', { question: toQuestionView(updated) }, 'all');
  return toHostQuestion(updated);
};
