import crypto from 'crypto';
import { audit } from '../../common/audit/audit';
import { ApiError } from '../../common/utils/ApiError';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { PresentationModel } from '../presentations/models/presentation.model';
import { PresentationSessionModel, type ISessionShare } from '../presentations/models/session.model';
import { getSlideType, isSlideScored, toParticipantSlide } from '../presentations/slides';
import { sessionSlides, slideIdOf } from '../presentations/live/state';
import { SESSION_ERROR_CODES, type PublicResults, type PublicResultSlide, type SessionShareView } from './contract';
import { authorizeSession } from './sessions.access';
import type { ShareInput } from './sessions.schema';

/**
 * Public results links. A share is a random capability token on the session
 * (`share.token`, unique sparse index); `/api/public/results/:token` serves
 * aggregated results of an ended session while the share is enabled and not
 * expired — never notes, emails, ids or (unless `includeNames`) names.
 */

/** 192 random bits, URL-safe (32 characters). */
export const newShareToken = () => crypto.randomBytes(24).toString('base64url');

/** Tokens are base64url; anything else is answered 404 without a lookup. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

export const isShareActive = (share: ISessionShare | null | undefined, now = Date.now()): boolean =>
  Boolean(share?.enabled && share.token && (!share.expiresAt || share.expiresAt.getTime() > now));

export const shareView = (share: ISessionShare | null | undefined, withToken: boolean): SessionShareView | null =>
  share?.token
    ? {
        token: withToken ? share.token : null,
        enabled: Boolean(share.enabled),
        includeNames: Boolean(share.includeNames),
        createdAt: new Date(share.createdAt ?? Date.now()).toISOString(),
        expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
        active: isShareActive(share),
      }
    : null;

const sessionLive = () =>
  new ApiError(409, 'End the session before sharing its results', SESSION_ERROR_CODES.sessionLive);

/**
 * Turns the public link on (creating the token on first use) and updates its
 * options. The token is kept across disable/enable unless `rotate` is set,
 * which invalidates every link handed out before.
 */
export const enableShare = async (sessionId: string, req: WorkspaceRequest, input: ShareInput): Promise<SessionShareView> => {
  const { session } = await authorizeSession(sessionId, req, 'session:share');
  if (session.isLive || session.status !== 'ended') throw sessionLive();

  const current = session.share?.token ? session.share : null;
  const rotated = !current || input.rotate === true;
  const expiresAt =
    input.expiresAt === undefined ? (current?.expiresAt ?? null) : input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw ApiError.badRequest('expiresAt must be in the future');

  const share: ISessionShare = {
    token: rotated ? newShareToken() : current!.token,
    enabled: true,
    includeNames: input.includeNames ?? current?.includeNames ?? false,
    createdAt: rotated ? new Date() : current!.createdAt,
    expiresAt,
  };
  await PresentationSessionModel.updateOne({ _id: session._id }, { $set: { share } });
  void audit(req, 'session.share.enable', { type: 'session', id: session._id }, {
    presentationId: String(session.presentationId),
    includeNames: share.includeNames,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    rotated: rotated && Boolean(current),
  });
  return shareView(share, true)!;
};

/** Turns the public link off (the token is kept for a later re-enable). Null when never shared. */
export const disableShare = async (sessionId: string, req: WorkspaceRequest): Promise<SessionShareView | null> => {
  const { session } = await authorizeSession(sessionId, req, 'session:share');
  const current = session.share;
  if (!current?.token) return null;
  const share: ISessionShare = {
    token: current.token,
    enabled: false,
    includeNames: current.includeNames,
    createdAt: current.createdAt,
    expiresAt: current.expiresAt,
  };
  await PresentationSessionModel.updateOne({ _id: session._id }, { $set: { 'share.enabled': false } });
  void audit(req, 'session.share.disable', { type: 'session', id: session._id }, {
    presentationId: String(session.presentationId),
  });
  return shareView(share, true);
};

const notAvailable = () => ApiError.notFound('These results are not available');

/** Leaderboard entries the public page may show: rank, name, score, correct count — no ids. */
const PUBLIC_LEADERBOARD_SIZE = 10;

export const getPublicResults = async (token: string): Promise<PublicResults> => {
  if (!TOKEN_PATTERN.test(token)) throw notAvailable();
  const session = await PresentationSessionModel.findOne({ 'share.token': token });
  if (!session || !isShareActive(session.share) || session.isLive || session.status !== 'ended') throw notAvailable();
  const presentation = await PresentationModel.findById(session.presentationId).select('title deletedAt').lean();
  if (!presentation || presentation.deletedAt) throw notAvailable();

  const slides = sessionSlides(session);
  const byId = new Map(slides.map((slide, index) => [slideIdOf(slide), { slide, index }]));
  const resultSlides: PublicResultSlide[] = [];
  for (const stat of [...(session.slideStats ?? [])].sort((a, b) => a.slideIndex - b.slideIndex)) {
    const found = byId.get(String(stat.slideId));
    const def = found ? getSlideType(found.slide.type) : undefined;
    if (!found || !def) continue;
    resultSlides.push({
      slideIndex: found.index,
      type: def.type,
      label: def.label(found.slide),
      scored: isSlideScored(found.slide),
      answeredCount: stat.answeredCount ?? 0,
      distribution: (stat.distribution ?? {}) as PublicResultSlide['distribution'],
      // The registry's participant allow-list: no notes, no answer keys.
      slide: toParticipantSlide(found.slide, found.index, slides.length),
    });
  }

  const includeNames = Boolean(session.share?.includeNames);
  return {
    title: presentation.title,
    runNumber: session.runNumber,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    participantCount: session.participantCount,
    answerCount: session.answerCount,
    includeNames,
    slides: resultSlides,
    leaderboard: includeNames
      ? session.finalLeaderboard.slice(0, PUBLIC_LEADERBOARD_SIZE).map(({ rank, name, score, correctCount }) => ({
          rank,
          name,
          score,
          correctCount,
        }))
      : null,
  };
};
