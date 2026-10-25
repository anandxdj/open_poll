/**
 * Carrying an invitation through sign-in. The invite page can't accept for a
 * signed-out visitor, who may also need to sign up and verify their email
 * (possibly in another tab) before signing in. So the page remembers the
 * invite path, and the login form sends the user back to it afterwards.
 */

const STORAGE_KEY = "openpoll_pending_invite";
/** An invitation lasts 7 days; a day is plenty to finish sign-up and verification. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Only `/invites/<token>` paths may be returned to (never an arbitrary redirect target). */
const INVITE_PATH = /^\/invites\/[A-Za-z0-9_-]{16,200}$/;

export const isInvitePath = (value: unknown): value is string => typeof value === "string" && INVITE_PATH.test(value);

export const invitePath = (token: string) => `/invites/${token}`;

export function rememberInvite(path: string, now: number = Date.now()): void {
  if (!isInvitePath(path)) return;
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
    if (isInvitePath(saved.path) && typeof saved.savedAt === "number" && now - saved.savedAt < MAX_AGE_MS) return saved.path;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Where to go after signing in: the `next` query value when it is an invite
 * path, else a remembered invitation, else null (the dashboard). Reading it
 * consumes the remembered invitation.
 */
export function takeInviteRedirect(next: string | null | undefined, now: number = Date.now()): string | null {
  const target = isInvitePath(next) ? next : recalled(now);
  forgetInvite();
  return target;
}
