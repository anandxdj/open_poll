import * as crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';

const SIGNING_SECRET =
  process.env.ID_SIGNING_SECRET ||
  process.env.JWT_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  (isProduction ? '' : 'dev-id-signing-secret');

if (!SIGNING_SECRET && isProduction) {
  throw new Error('ID_SIGNING_SECRET (or JWT_ACCESS_SECRET) must be set in production!');
}

const hmac = (value: string) =>
  crypto.createHmac('sha256', SIGNING_SECRET).update(value).digest('hex');

/** Constant-time comparison of two hex strings. */
const safeEqual = (a: string, b: string) => {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

export const newRandomId = () => crypto.randomBytes(16).toString('hex');

/**
 * HMAC (hex) of `value` under a purpose prefix, so a signature minted for one
 * purpose never verifies for another (e.g. `slide-ticket.v1`).
 */
export const scopedHmac = (scope: string, value: string) => hmac(`${scope}\u0000${value}`);

/** Constant-time comparison of two hex strings of equal length. */
export const hexEquals = (a: string, b: string) => /^[a-f0-9]*$/.test(a) && /^[a-f0-9]*$/.test(b) && safeEqual(a, b);

/**
 * Signs an opaque identifier so the server can later prove it issued it.
 * Format: `<id>.<hmac>` — the id itself carries no user data.
 */
export const signId = (id: string) => `${id}.${hmac(id)}`;

/** Returns the id if the signature is valid, otherwise null. */
export const verifySignedId = (signed: unknown): string | null => {
  if (typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  if (!/^[a-f0-9]{64}$/.test(sig) || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return null;
  return safeEqual(sig, hmac(id)) ? id : null;
};

/**
 * Ballot tokens bind a server-issued ballot id to a specific poll so a token
 * minted for one poll cannot vote on another.
 * Format: `<pollId>.<ballotId>.<hmac(pollId.ballotId)>`
 */
export const issueBallotToken = (pollId: string) => {
  const ballotId = newRandomId();
  const body = `${pollId}.${ballotId}`;
  return { ballotId, token: `${body}.${hmac(body)}` };
};

/**
 * Guest identity tokens: the server vouches that it saw this name/email pair.
 * Format: `g.<base64url(email\nname)>.<hmac(payload)>`
 */
export const issueGuestToken = (email: string, name: string) => {
  const payload = Buffer.from(`${email}\n${name}`, 'utf8').toString('base64url');
  return `g.${payload}.${hmac(payload)}`;
};

/** Returns { email, name } if the guest token is authentic, otherwise null. */
export const verifyGuestToken = (
  token: unknown,
): { email: string; name: string } | null => {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'g') return null;
  const [, payload, sig] = parts as [string, string, string];
  if (!/^[a-f0-9]{64}$/.test(sig) || !safeEqual(sig, hmac(payload))) return null;
  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const nl = decoded.indexOf('\n');
  if (nl <= 0) return null;
  return { email: decoded.slice(0, nl), name: decoded.slice(nl + 1) };
};

/** Returns the ballotId if the token is valid for this poll, otherwise null. */
export const verifyBallotToken = (token: unknown, pollId: string): string | null => {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [tokenPollId, ballotId, sig] = parts as [string, string, string];
  if (tokenPollId !== pollId) return null;
  if (!/^[a-f0-9]{64}$/.test(sig) || !/^[a-f0-9]{32}$/.test(ballotId)) return null;
  return safeEqual(sig, hmac(`${tokenPollId}.${ballotId}`)) ? ballotId : null;
};
