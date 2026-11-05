import { randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { redisClient } from '../../common/config/redis';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { hashToken } from '../../common/utils/jwt.utils';
import { authorizeDeck } from '../presentations/access';
import { PresentationModel, type IPresentation } from '../presentations/models/presentation.model';
import { ScreenTokenModel, type IScreenToken } from './screenToken.model';

/**
 * Screen tokens (W4-D): create, list and revoke them for one deck, and turn a
 * presented token back into its deck. Managing tokens needs `deck:share` on the
 * deck (owner, admin and editor roles: the people who may hand the deck out);
 * a token only ever reads that one deck's stage.
 */

/** Active tokens one deck keeps. */
export const MAX_SCREEN_TOKENS_PER_DECK = 20;

/** `scr_` + 32 random bytes, base64url (43 characters). */
const TOKEN_PATTERN = /^scr_[A-Za-z0-9_-]{43}$/;

/**
 * Redis channel every instance listens to, so screens leave the deck at once:
 * one token's (revoked) or every screen of the deck (embedding turned off).
 */
export const SCREEN_REVOKED_CHANNEL = 'embeds:screen-revoked';

/** Why screens were sent away (`screen:revoked` payload). */
export type ScreenRevokeReason = 'revoked' | 'embed_disabled';

export interface ScreenRevokedMessage {
  presentationId: string;
  /** Only this token's screens; every screen of the deck when absent. */
  tokenId?: string;
  reason: ScreenRevokeReason;
}

/** Tells every instance to send the screens away. Best-effort: a missed message still leaves the next read or join refused. */
export async function announceScreensRevoked(message: ScreenRevokedMessage): Promise<void> {
  await redisClient
    .publish(SCREEN_REVOKED_CHANNEL, JSON.stringify(message))
    .catch((error) => console.error('[Embeds] Could not announce revoked screens:', error));
}

/** `lastUsedAt` is written at most this often per token (a screen resyncs often). */
const LAST_USED_WRITE_MS = 5 * 60 * 1000;

export interface ScreenTokenView {
  id: string;
  presentationId: string;
  label: string;
  prefix: string;
  last4: string;
  lastUsedAt: string | null;
  createdAt: string;
}

const view = (token: IScreenToken): ScreenTokenView => ({
  id: String(token._id),
  presentationId: String(token.presentationId),
  label: token.label,
  prefix: token.prefix,
  last4: token.last4,
  lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
  createdAt: token.createdAt.toISOString(),
});

const notFound = () => ApiError.notFound('Screen link not found');

export const isScreenTokenFormat = (token: unknown): token is string =>
  typeof token === 'string' && TOKEN_PATTERN.test(token);

export async function listScreenTokens(req: WorkspaceRequest, presentationId: string): Promise<ScreenTokenView[]> {
  await authorizeDeck(presentationId, req, 'deck:share');
  const tokens = await ScreenTokenModel.find({ presentationId, revokedAt: null }).sort({ createdAt: -1 });
  return tokens.map(view);
}

/** The token itself is returned only here. */
export async function createScreenToken(
  req: WorkspaceRequest,
  input: { presentationId: string; label: string },
): Promise<ScreenTokenView & { token: string }> {
  const deck = await authorizeDeck(input.presentationId, req, 'deck:share');
  const active = await ScreenTokenModel.countDocuments({ presentationId: deck._id, revokedAt: null });
  if (active >= MAX_SCREEN_TOKENS_PER_DECK) {
    throw new ApiError(409, `A deck keeps up to ${MAX_SCREEN_TOKENS_PER_DECK} screen links`, 'SCREEN_TOKEN_LIMIT');
  }
  const secret = `scr_${randomBytes(32).toString('base64url')}`;
  const token = await ScreenTokenModel.create({
    workspaceId: deck.workspaceId ?? null,
    presentationId: deck._id,
    label: input.label,
    tokenHash: hashToken(secret),
    prefix: secret.slice(0, 8),
    last4: secret.slice(-4),
    createdBy: mongoose.isValidObjectId(req.user?.id) ? req.user!.id : null,
  });
  void audit(req, 'embed.screen_token_create', { type: 'screen_token', id: token._id }, {
    presentationId: String(deck._id),
    label: token.label,
  });
  return { token: secret, ...view(token) };
}

export async function revokeScreenToken(req: WorkspaceRequest, id: string): Promise<{ id: string; revoked: true }> {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const existing = await ScreenTokenModel.findOne({ _id: id, revokedAt: null });
  if (!existing) throw notFound();
  // Same answer as a missing token when the caller may not manage the deck: no existence leak.
  try {
    await authorizeDeck(String(existing.presentationId), req, 'deck:share');
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)) throw notFound();
    throw error;
  }
  const token = await ScreenTokenModel.findOneAndUpdate(
    { _id: existing._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!token) throw notFound();
  await announceScreensRevoked({ presentationId: String(token.presentationId), tokenId: String(token._id), reason: 'revoked' });
  void audit(req, 'embed.screen_token_revoke', { type: 'screen_token', id: token._id }, {
    presentationId: String(token.presentationId),
    label: token.label,
  });
  return { id: String(token._id), revoked: true };
}

export interface ResolvedScreen {
  token: IScreenToken;
  presentation: IPresentation;
}

/**
 * The live token and its deck (not in the trash), or null for anything else:
 * malformed, unknown, revoked, or a deleted deck. Callers decide what a refusal
 * looks like; none of them says which of these it was.
 */
export async function resolveScreenToken(secret: unknown): Promise<ResolvedScreen | null> {
  if (!isScreenTokenFormat(secret)) return null;
  const token = await ScreenTokenModel.findOne({ tokenHash: hashToken(secret), revokedAt: null });
  if (!token) return null;
  const presentation = await PresentationModel.findById(token.presentationId);
  if (!presentation || presentation.deletedAt) return null;
  // A token outlives a move only inside its workspace.
  if (String(presentation.workspaceId ?? '') !== String(token.workspaceId ?? '')) return null;
  const now = Date.now();
  if (!token.lastUsedAt || now - token.lastUsedAt.getTime() > LAST_USED_WRITE_MS) {
    token.lastUsedAt = new Date(now);
    void ScreenTokenModel.updateOne({ _id: token._id }, { $set: { lastUsedAt: token.lastUsedAt } }).catch(() => undefined);
  }
  return { token, presentation };
}

/** Whether embedding (and so screens) is turned on for the deck. Off by default. */
export const isEmbedAllowed = (presentation: Pick<IPresentation, 'settings'>) => presentation.settings?.embed?.allowed === true;

/**
 * The screen for `presentationId`, when `secret` is a live token of that very
 * deck and the deck allows embedding; null otherwise.
 */
export async function authorizeScreen(presentationId: string, secret: unknown): Promise<ResolvedScreen | null> {
  const resolved = await resolveScreenToken(secret);
  if (!resolved || String(resolved.presentation._id) !== presentationId) return null;
  return isEmbedAllowed(resolved.presentation) ? resolved : null;
}
