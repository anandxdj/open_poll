import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { REALTIME_CHANNELS } from '../../common/realtime/events';
import { publishLiveEvent } from '../../common/realtime/publish';
import { ApiError } from '../../common/utils/ApiError';
import { authorizeDeck, getPresentationById, type Actor } from '../presentations/access';
import type { IPresentationSession } from '../presentations/models/session.model';
import { PresentationService } from '../presentations/presentations.service';
import { getParticipantCount } from '../presentations/live/distribution';
import {
  findLatestSession,
  findLiveSession,
  isPausedState,
  lifecycleOf,
  readSlideState,
  sessionSlides,
  slideIdOf,
  slidePhase,
  timerBudgetMs,
  windowEnd,
  type Slide,
} from '../presentations/live/state';
import { answeredCounts } from '../presentations/live/views';
import { RemoteTokenModel, type IRemoteToken } from './remote.model';
import {
  REMOTE_ERROR_CODES,
  type RemoteCommand,
  type RemoteSlideView,
  type RemoteState,
  type RemoteStatus,
  type RemoteTokenCreated,
} from './remote.contract';

/**
 * Phone remote (W2-A). A host pairs a phone by showing a one-time token as a
 * QR code; the phone opens `/remote/<token>` and drives the deck over its own
 * socket (`remote.socket.ts`).
 *
 * - **At rest** only `sha256(token)` is stored, and the first device to redeem
 *   the token binds it (`sha256(deviceKey)`, a random key the phone keeps in
 *   localStorage): the link alone is worthless to a second device.
 * - **One pairing per deck.** Creating one revokes the previous; `DELETE`
 *   revokes it; it expires after `REMOTE_TOKEN_TTL_MS`. Revocation drops the
 *   remote's sockets out of the deck's rooms on every instance at once, and
 *   every command re-checks the pairing first.
 * - **Commands run as the host who paired** (bare user id actor): the deck's
 *   `deck:host` policy is evaluated on every command, so a host who loses the
 *   right also loses the remote.
 */

export const REMOTE_TOKEN_TTL_MS = 24 * 3600 * 1000;
const TOKEN_PREFIX = 'rt1.';
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{22,128}$/;
const TOKEN_RE = /^rt1\.[A-Za-z0-9_-]{43}$/;
/** Redis SET of the remote socket ids connected to a deck (all instances); drives connected/disconnected. */
const socketsKey = (presentationId: string) => `remote:{${presentationId}}:sockets`;
const SOCKETS_TTL_SEC = 12 * 3600;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const hashRemoteToken = (token: string) => sha256(token);

const invalid = () => new ApiError(404, 'This remote link is no longer valid', REMOTE_ERROR_CODES.invalid);
const boundElsewhere = () =>
  new ApiError(403, 'This remote is paired with another device', REMOTE_ERROR_CODES.bound);
const badDevice = () => new ApiError(400, 'A device key is required', REMOTE_ERROR_CODES.badDevice);

export const isWellFormedToken = (token: unknown): token is string => typeof token === 'string' && TOKEN_RE.test(token);
export const isWellFormedDeviceKey = (key: unknown): key is string => typeof key === 'string' && DEVICE_KEY_RE.test(key);

const activeFilter = (presentationId: string) => ({
  presentationId: new mongoose.Types.ObjectId(presentationId),
  revokedAt: null,
  expiresAt: { $gt: new Date() },
});

const isActive = (doc: IRemoteToken | null): doc is IRemoteToken =>
  !!doc && !doc.revokedAt && doc.expiresAt.getTime() > Date.now();

// ---------------------------------------------------------------------------
// Presence (connected / disconnected), shared by every instance through Redis
// ---------------------------------------------------------------------------

const publishPresence = (presentationId: string, connected: boolean) =>
  publishLiveEvent({
    presentationId,
    type: connected ? 'remote:connected' : 'remote:disconnected',
    payload: { at: new Date().toISOString() },
  });

/** A remote socket joined the deck. The first one announces `remote:connected` to the host. */
export const noteRemoteSocketJoined = async (presentationId: string, socketId: string) => {
  try {
    const key = socketsKey(presentationId);
    const added = await redisClient.sAdd(key, socketId);
    await redisClient.expire(key, SOCKETS_TTL_SEC);
    if (added === 1 && (await redisClient.sCard(key)) === 1) await publishPresence(presentationId, true);
  } catch (error) {
    console.error('[Remote] Failed to record a remote socket:', error);
  }
};

/** A remote socket left. The last one announces `remote:disconnected`. */
export const noteRemoteSocketLeft = async (presentationId: string, socketId: string) => {
  try {
    const key = socketsKey(presentationId);
    const removed = await redisClient.sRem(key, socketId);
    if (removed === 1 && (await redisClient.sCard(key)) === 0) await publishPresence(presentationId, false);
  } catch (error) {
    console.error('[Remote] Failed to drop a remote socket:', error);
  }
};

const isConnected = async (presentationId: string) =>
  (await redisClient.sCard(socketsKey(presentationId)).catch(() => 0)) > 0;

// ---------------------------------------------------------------------------
// Pairing (host)
// ---------------------------------------------------------------------------

const statusOf = async (presentationId: string, doc: IRemoteToken | null): Promise<RemoteStatus> => ({
  paired: isActive(doc),
  bound: isActive(doc) && !!doc.deviceHash,
  boundAt: isActive(doc) && doc.boundAt ? doc.boundAt.toISOString() : null,
  expiresAt: isActive(doc) ? doc.expiresAt.toISOString() : null,
  connected: isActive(doc) ? await isConnected(presentationId) : false,
});

/** Drops every remote socket of the deck out of its rooms (all instances) and tells the host. */
const disconnectRemotes = async (presentationId: string) => {
  await redisClient
    .publish(REALTIME_CHANNELS.remoteControl, JSON.stringify({ kind: 'revoke', presentationId }))
    .catch((error) => console.error('[Remote] Failed to publish a revoke:', error));
  const hadSockets = await redisClient.del(socketsKey(presentationId)).catch(() => 0);
  if (hadSockets) await publishPresence(presentationId, false);
};

const revokeActive = async (presentationId: string) => {
  const { modifiedCount } = await RemoteTokenModel.updateMany(activeFilter(presentationId), {
    $set: { revokedAt: new Date() },
  });
  if (modifiedCount > 0) await disconnectRemotes(presentationId);
};

export const RemoteService = {
  /** The deck's pairing state (policy `deck:host`). */
  async status(presentationId: string, actor: Actor): Promise<RemoteStatus> {
    await authorizeDeck(presentationId, actor, 'deck:host');
    const doc = await RemoteTokenModel.findOne(activeFilter(presentationId)).sort({ createdAt: -1 });
    return statusOf(presentationId, doc);
  },

  /** A new pairing token (the previous one is revoked). The plain token is returned once. */
  async createToken(presentationId: string, actor: Actor, userId: string): Promise<RemoteTokenCreated> {
    const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
    await revokeActive(presentationId);
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + REMOTE_TOKEN_TTL_MS);
    await RemoteTokenModel.create({
      presentationId: presentation._id,
      workspaceId: presentation.workspaceId ?? null,
      createdBy: userId,
      tokenHash: hashRemoteToken(token),
      expiresAt,
    });
    return { token, path: `/remote/${token}`, expiresAt: expiresAt.toISOString() };
  },

  /** Revokes the deck's pairing; a connected remote is dropped at once. */
  async revoke(presentationId: string, actor: Actor): Promise<RemoteStatus> {
    await authorizeDeck(presentationId, actor, 'deck:host');
    await revokeActive(presentationId);
    return statusOf(presentationId, null);
  },

  /**
   * Checks a token and the device presenting it. An unbound pairing binds to
   * this device (atomically: of two devices racing, one wins and the other is
   * refused). 404 `REMOTE_INVALID`, 403 `REMOTE_BOUND`, 400 for a bad key.
   */
  async redeem(token: unknown, deviceKey: unknown): Promise<IRemoteToken> {
    if (!isWellFormedToken(token)) throw invalid();
    if (!isWellFormedDeviceKey(deviceKey)) throw badDevice();
    const doc = await RemoteTokenModel.findOne({ tokenHash: hashRemoteToken(token) });
    if (!isActive(doc)) throw invalid();
    const deviceHash = sha256(deviceKey);
    if (!doc.deviceHash) {
      const now = new Date();
      const bound = await RemoteTokenModel.findOneAndUpdate(
        { _id: doc._id, deviceHash: null, revokedAt: null },
        { $set: { deviceHash, boundAt: now, lastUsedAt: now } },
        { returnDocument: 'after' }
      );
      if (bound) return bound;
      const current = await RemoteTokenModel.findById(doc._id);
      if (!isActive(current)) throw invalid();
      if (current.deviceHash !== deviceHash) throw boundElsewhere();
      return current;
    }
    if (doc.deviceHash !== deviceHash) throw boundElsewhere();
    return doc;
  },

  /** Re-reads a pairing by id (every remote command): still active, or 404. */
  async requireActive(tokenId: string): Promise<IRemoteToken> {
    const doc = mongoose.isValidObjectId(tokenId) ? await RemoteTokenModel.findById(tokenId) : null;
    if (!isActive(doc)) throw invalid();
    return doc;
  },

  /** What the remote shows: the deck's live (else latest) session and its current slide. */
  state: (presentationId: string) => remoteState(presentationId),

  /** Runs one remote command as the host who paired; returns the new state. */
  async command(pairing: IRemoteToken, command: RemoteCommand): Promise<RemoteState> {
    const presentationId = String(pairing.presentationId);
    const actor = pairing.createdBy;
    const live = await findLiveSession(presentationId);
    const index = live?.currentSlideIndex ?? -1;
    switch (command) {
      case 'next':
        if (!live) throw ApiError.badRequest('Start the session from the presenter view first');
        if (index >= sessionSlides(live).length - 1) throw ApiError.badRequest('This is the last slide');
        await PresentationService.gotoSlide(presentationId, actor, { slideIndex: index + 1 });
        break;
      case 'prev':
        if (!live || index <= 0) throw ApiError.badRequest('This is the first slide');
        await PresentationService.gotoSlide(presentationId, actor, { slideIndex: index - 1 });
        break;
      case 'reveal':
        await PresentationService.revealCurrentSlide(presentationId, actor);
        break;
      case 'close':
        await PresentationService.closeCurrentSlide(presentationId, actor);
        break;
      case 'extend30':
        await PresentationService.extendTimer(presentationId, actor, 30);
        break;
      case 'pause':
        await PresentationService.pauseTimer(presentationId, actor);
        break;
      case 'resume':
        await PresentationService.resumeTimer(presentationId, actor);
        break;
    }
    void RemoteTokenModel.updateOne({ _id: pairing._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    return remoteState(presentationId);
  },
};

// ---------------------------------------------------------------------------
// Remote state
// ---------------------------------------------------------------------------

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** A human title for any slide: its question, else its content's headline. */
export const slideTitle = (slide: Pick<Slide, 'type' | 'question' | 'content'>): string => {
  const question = text(slide.question);
  if (question) return question;
  const content = (slide.content ?? {}) as Record<string, unknown>;
  for (const field of ['title', 'text', 'label', 'value', 'caption', 'alt', 'body']) {
    const value = text(content[field]);
    if (value) return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  return slide.type;
};

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

const slideView = (session: IPresentationSession, index: number, answered: number): RemoteSlideView | null => {
  const slides = sessionSlides(session);
  const slide = slides[index];
  if (!slide) return null;
  const slideId = slideIdOf(slide);
  const lifecycle = lifecycleOf(slide.type);
  const state = readSlideState(session, slideId);
  const phase = slidePhase(lifecycle, state);
  const response = lifecycle === 'response';
  return {
    slideId,
    slideIndex: index,
    type: slide.type,
    lifecycle,
    title: slideTitle(slide),
    phase,
    isLastSlide: index === slides.length - 1,
    timed: response && phase === 'open' && (Boolean(state?.endsAt) || isPausedState(state)),
    startedAt: response ? iso(state?.openedAt) : null,
    endsAt: response ? iso(windowEnd(state)) : null,
    pausedRemainingMs: response && phase === 'open' ? (state?.pausedRemainingMs ?? null) : null,
    durationMs: response ? timerBudgetMs(state) : null,
    answeredCount: answered,
    notes: text(slide.notes),
  };
};

const remoteState = async (presentationId: string): Promise<RemoteState> => {
  const presentation = await getPresentationById(presentationId);
  const session = (await findLiveSession(presentationId)) ?? (await findLatestSession(presentationId));
  const base = {
    presentationId,
    title: presentation.title,
    joinCode: presentation.joinCode,
    serverNow: new Date().toISOString(),
  };
  if (!session) {
    return {
      ...base,
      status: 'draft',
      sessionId: null,
      participantCount: 0,
      totalSlides: presentation.slides.length,
      currentSlideIndex: -1,
      slide: null,
      next: null,
    };
  }
  const slides = sessionSlides(session);
  const index = session.currentSlideIndex;
  const counts = await answeredCounts(session);
  const current = index >= 0 ? slides[index] : undefined;
  const nextSlide = session.status === 'ended' ? undefined : slides[index + 1];
  return {
    ...base,
    status: session.status,
    sessionId: String(session._id),
    joinCode: session.joinCode,
    participantCount: session.isLive ? await getParticipantCount(String(session._id)) : session.participantCount,
    totalSlides: slides.length,
    currentSlideIndex: index,
    slide: current && session.status === 'active' ? slideView(session, index, counts.get(slideIdOf(current)) ?? 0) : null,
    next: nextSlide ? { slideIndex: index + 1, type: nextSlide.type, title: slideTitle(nextSlide) } : null,
  };
};
