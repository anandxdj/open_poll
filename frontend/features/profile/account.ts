/**
 * Rules and copy of the profile page, mirrored from the API (backend
 * `modules/auth/dto/update-profile.schema.ts`, `change-password.schema.ts`).
 * The server has the final word; these only give feedback before the request.
 */

export const NAME_MAX_LENGTH = 80;

export const PASSWORD_RULE = "At least 8 characters, with one uppercase letter and one number.";

/** Codes of `PATCH /api/me` and `POST /api/me/password` errors. */
export const ACCOUNT_ERROR_CODES = {
  wrongPassword: "WRONG_PASSWORD",
  noPassword: "NO_PASSWORD",
} as const;

/** Why a name can't be saved, or null. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter your name.";
  if (trimmed.length > NAME_MAX_LENGTH) return `Use at most ${NAME_MAX_LENGTH} characters.`;
  return null;
}

/** What is wrong with a new password (same floor as reset-password), or null. */
export function newPasswordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[A-Z]/.test(password) || !/\d/.test(password)) return "Include at least one uppercase letter and one number.";
  return null;
}

const SSO_PROVIDERS = new Set(["oidc", "saml", "oidc_ws"]);

/** How a passwordless account signs in, for "You sign in with …". */
export function signInMethod(identities: { provider: string }[] | undefined): string {
  const providers = new Set((identities ?? []).map((identity) => identity.provider));
  const google = providers.has("google");
  const sso = [...providers].some((provider) => SSO_PROVIDERS.has(provider));
  if (google && !sso) return "Google";
  if (sso && !google) return "single sign-on";
  return "Google or single sign-on";
}
