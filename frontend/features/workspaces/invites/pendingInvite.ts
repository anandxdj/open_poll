/**
 * Carrying an invitation through sign-in. The invite page can't accept for a
 * signed-out visitor, who may also need to sign up and verify their email
 * (possibly in another tab) before signing in. So the page remembers the
 * invite path, and the login form sends the user back to it afterwards.
 *
 * The privacy page uses the same round trip when an account without a
 * password signs in again to confirm its deletion (RETURN_PATHS).
 */

const STORAGE_KEY = "openpoll_pending_invite";
/** An invitation lasts 7 days; a day is plenty to finish sign-up and verification. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Only `/invites/<token>` paths may be returned to (never an arbitrary redirect target). */
const INVITE_PATH = /^\/invites\/[A-Za-z0-9_-]{16,200}$/;

/** Other pages a sign-in may come back to. */
const RETURN_PATHS: ReadonlySet<string> = new Set(["/settings/privacy"]);

export const isInvitePath = (value: unknown): value is string => typeof value === "string" && INVITE_PATH.test(value);

const isReturnPath = (value: unknown): value is string =>
  isInvitePath(value) || (typeof value === "string" && RETURN_PATHS.has(value));

export const invitePath = (token: string) => `/invites/${token}`;

export function rememberInvite(path: string, now: number = Date.now()): void {
  if (!isReturnPath(path)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ path, savedAt: now }));
  } catch {
    // Private mode or storage disabled: the user can reopen the emailed link.
  }
}

export function forgetInvite(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function recalled(now: number): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { path?: unknown; savedAt?: unknown };
    if (isReturnPath(saved.path) && typeof saved.savedAt === "number" && now - saved.savedAt < MAX_AGE_MS) return saved.path;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Where to go after signing in: the `next` query value when it is an invite
 * (or other allowed) path, else a remembered one, else null (the dashboard).
 * Reading it consumes the remembered path.
 */
export function takeInviteRedirect(next: string | null | undefined, now: number = Date.now()): string | null {
  const target = isReturnPath(next) ? next : recalled(now);
  forgetInvite();
  return target;
}
