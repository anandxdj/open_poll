import type { Types } from 'mongoose';
import type { IUser, IdentityProvider } from './auth.model';

/**
 * Provider identities live in `user.identities[]` as (provider, connectionId,
 * subject). Google, the global OIDC provider and future per-workspace SSO
 * connections each get their own entry, so signing in with one provider never
 * overwrites another's link (the old shared `user.sub` did).
 */
export interface ProviderIdentity {
  provider: IdentityProvider;
  subject: string;
  /** Per-workspace SSO connection (`saml`, `oidc_ws`); absent for google/oidc. */
  connectionId?: Types.ObjectId | string | null;
}

const sameConnection = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

/** Mongo filter matching the user that holds exactly this identity. */
export const identityFilter = ({ provider, subject, connectionId }: ProviderIdentity) => ({
  identities: { $elemMatch: { provider, subject, connectionId: connectionId ?? null } },
});

/** The user's link for this provider (and connection), whatever its subject. */
export const linkedIdentity = (
  user: Pick<IUser, 'identities'>,
  provider: IdentityProvider,
  connectionId?: ProviderIdentity['connectionId'],
) => (user.identities ?? []).find((entry) => entry.provider === provider && sameConnection(entry.connectionId, connectionId));

/**
 * Records the identity on the user (unsaved), replacing any other subject for
 * the same provider and connection. Callers decide beforehand whether a
 * different existing subject is a conflict.
 */
export function linkIdentity(user: IUser, identity: ProviderIdentity) {
  const current = linkedIdentity(user, identity.provider, identity.connectionId);
  if (current?.subject === identity.subject) return;
  const entry = { provider: identity.provider, subject: identity.subject, connectionId: identity.connectionId ?? null };
  if (!current) {
    user.identities.push(entry);
    return;
  }
  user.set(
    'identities',
    [
      ...user.identities
        .filter((existing) => existing !== current)
        .map((existing) => ({ provider: existing.provider, subject: existing.subject, connectionId: existing.connectionId ?? null })),
      entry,
    ],
  );
}
