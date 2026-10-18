import axios from "axios";

/** Server-provided `message` from an API error response, if there is one. */
export function getApiErrorMessage(err: unknown): string | undefined {
  if (!axios.isAxiosError<{ message?: unknown }>(err)) return undefined;
  const message = err.response?.data?.message;
  return typeof message === "string" ? message : undefined;
}

/** HTTP status of an API error response, if there is one. */
export function getApiErrorStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}
