import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { UserModel } from '../src/modules/auth/auth.model';
import { AuthService } from '../src/modules/auth/auth.service';
import { OidcService } from '../src/modules/auth/oidc.service';

/**
 * In-memory stand-in for the users collection, enough for the account-linking
 * queries: { identities: { $elemMatch } }, { sub }, { email }.
 */
const users: any[] = [];
const saved = { findOne: UserModel.findOne, create: UserModel.create };

const matches = (user: any, filter: Record<string, any>) =>
  Object.entries(filter).every(([field, expected]) => {
    if (field === 'identities') {
      const want = expected.$elemMatch;
      return (user.identities ?? []).some(
        (entry: any) =>
          entry.provider === want.provider &&
          entry.subject === want.subject &&
          String(entry.connectionId ?? null) === String(want.connectionId ?? null),
      );
    }
    return user.get(field) === expected;
  });

beforeEach(() => {
  users.length = 0;
  (UserModel as any).findOne = async (filter: Record<string, any>) => users.find((user) => matches(user, filter)) ?? null;
  (UserModel as any).create = async (data: Record<string, unknown>) => {
    const user = new UserModel({ _id: new mongoose.Types.ObjectId(), ...data });
    users.push(user);
    return user;
  };
});

afterEach(() => {
  (UserModel as any).findOne = saved.findOne;
  (UserModel as any).create = saved.create;
});

const seed = (data: Record<string, unknown>) => {
  const user = UserModel.hydrate({ _id: new mongoose.Types.ObjectId(), role: 'user', ...data });
  users.push(user);
  return user;
};

const subjects = (user: any, provider: string) =>
  user.identities.filter((entry: any) => entry.provider === provider).map((entry: any) => entry.subject);

const google = { sub: '109876543210987654321', email: 'Ada@Example.com', email_verified: true, name: 'Ada' };
const oidcClaims = { sub: 'idp|ada', email: 'ada@example.com', email_verified: true, name: 'Ada L.' };

describe('provider identities', () => {
  it('links Google and then OIDC for the same email to one account', async () => {
    const viaGoogle = await AuthService.findOrLinkGoogleUser(google);
    expect(subjects(viaGoogle, 'google')).toEqual([google.sub]);
    expect(viaGoogle.sub).toBeUndefined();

    // Before identities[], Google's subject in `sub` made this a 409.
    const viaOidc = await OidcService.findOrLinkUser(oidcClaims);
    expect(String(viaOidc._id)).toBe(String(viaGoogle._id));
    expect(subjects(viaOidc, 'google')).toEqual([google.sub]);
    expect(subjects(viaOidc, 'oidc')).toEqual(['idp|ada']);
    expect(users).toHaveLength(1);

    // Both providers keep resolving to the same account afterwards.
    expect(String((await AuthService.findOrLinkGoogleUser(google))._id)).toBe(String(viaGoogle._id));
    expect(String((await OidcService.findOrLinkUser(oidcClaims))._id)).toBe(String(viaGoogle._id));
  });

  it('links OIDC and then Google for the same email to one account', async () => {
    const viaOidc = await OidcService.findOrLinkUser(oidcClaims);
    const viaGoogle = await AuthService.findOrLinkGoogleUser(google);
    expect(String(viaGoogle._id)).toBe(String(viaOidc._id));
    expect(subjects(viaGoogle, 'oidc')).toEqual(['idp|ada']);
    expect(subjects(viaGoogle, 'google')).toEqual([google.sub]);
  });

  it('does not let a Google subject left in legacy `sub` block an OIDC login', async () => {
    seed({ email: 'ada@example.com', name: 'Ada', isVerified: true, sub: google.sub });
    const user = await OidcService.findOrLinkUser(oidcClaims);
    expect(subjects(user, 'oidc')).toEqual(['idp|ada']);
  });

  it('finds a pre-identities OIDC account by legacy `sub` and backfills the identity', async () => {
    // The IdP email changed since the account was linked, so email alone would miss it.
    const legacy = seed({ email: 'old-address@example.com', name: 'Ada', isVerified: true, sub: 'idp|ada' });
    const user = await OidcService.findOrLinkUser(oidcClaims);
    expect(String(user._id)).toBe(String(legacy._id));
    expect(subjects(user, 'oidc')).toEqual(['idp|ada']);
    expect(user.email).toBe('ada@example.com');
    expect(users).toHaveLength(1);
  });

  it('still refuses a second OIDC subject for an account', async () => {
    seed({ email: 'ada@example.com', name: 'Ada', isVerified: true, identities: [{ provider: 'oidc', subject: 'idp|someone-else' }] });
    await expect(OidcService.findOrLinkUser(oidcClaims)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('wipes a pre-registered password when Google claims an unverified account', async () => {
    seed({
      email: 'ada@example.com',
      name: 'Squatter',
      role: 'admin',
      isVerified: false,
      password: '$2b$12$m4daYAiMWvh.MRFjcFKTeOzM0qFhjU101NDgsvIEM7qHIQvdl71j.',
      verificationToken: 'pending',
    });
    const user: any = await AuthService.findOrLinkGoogleUser(google);
    expect(user.password).toBeUndefined();
    expect(user.verificationToken).toBeUndefined();
    expect(user.role).toBe('user');
    expect(user.isVerified).toBe(true);
    expect(user.$getChanges().$unset).toMatchObject({ password: 1, verificationToken: 1 });
  });

  it('resolves a Google account by identity after its email changes', async () => {
    const first = await AuthService.findOrLinkGoogleUser(google);
    const renamed = await AuthService.findOrLinkGoogleUser({ ...google, email: 'ada.lovelace@example.com' });
    expect(String(renamed._id)).toBe(String(first._id));
    expect(users).toHaveLength(1);
  });

  it('replaces the Google link when a different Google account proves the same email', async () => {
    seed({ email: 'ada@example.com', name: 'Ada', isVerified: true, identities: [{ provider: 'google', subject: 'old-google' }] });
    const user = await AuthService.findOrLinkGoogleUser(google);
    expect(subjects(user, 'google')).toEqual([google.sub]);
  });

  it('refuses an unverified Google email', async () => {
    await expect(AuthService.findOrLinkGoogleUser({ ...google, email_verified: false })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
