import axios from "axios";

/** Machine-readable `code` of an API error response (e.g. `INVITE_EMAIL_MISMATCH`), if there is one. */
export function getApiErrorCode(err: unknown): string | undefined {
  if (!axios.isAxiosError<{ code?: unknown }>(err)) return undefined;
  const code = err.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}
