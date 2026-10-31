import { apiClient } from "@/lib/api-client";
import { fileNameFromDisposition } from "@/features/sessions/api/sessions";
import type { PrivacyStatus } from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

export const getPrivacyStatus = async () => (await apiClient.get<ApiOk<PrivacyStatus>>("/me/privacy")).data.data;

/** Builds the archive on the server and saves it through the browser (the API needs the bearer token). */
export async function downloadMyData(fallbackName: string) {
  // An empty object, not null: the API's JSON parser rejects a bare `null` body.
  const res = await apiClient.post<Blob>("/me/export", {}, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFromDisposition(res.headers["content-disposition"], fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Password accounts confirm their password; resolves with the end of the 5-minute window. */
export const confirmPassword = async (password: string) =>
  (await apiClient.post<ApiOk<{ reauthUntil: string }>>("/me/reauth", { password })).data.data;

/** Schedules the account's deletion; the server signs it out everywhere. */
export const deleteAccount = async () => (await apiClient.delete<ApiOk<{ purgeAt: string }>>("/me")).data.data;
