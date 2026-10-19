import axios, { type AxiosInstance } from "axios";
import { apiClient } from "@/lib/api-client";
import { getApiBaseUrl } from "@/lib/env";
import type {
  ExportFormat,
  PublicResults,
  SessionListPage,
  SessionReport,
  SessionShare,
  ShareInput,
  TakeHome,
} from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

// Host routes go through the shared client (bearer token + selected workspace).

export const listSessions = async (presentationId: string, cursor?: string | null, limit = 20) =>
  (
    await apiClient.get<ApiOk<SessionListPage>>("/sessions", {
      params: { presentationId, limit, ...(cursor ? { cursor } : {}) },
    })
  ).data.data;

export const getSessionReport = async (sessionId: string) =>
  (await apiClient.get<ApiOk<SessionReport>>(`/sessions/${sessionId}`)).data.data;

export const enableShare = async (sessionId: string, input: ShareInput = {}) =>
  (await apiClient.post<ApiOk<SessionShare>>(`/sessions/${sessionId}/share`, input)).data.data;

/** Resolves to null when the session was never shared. */
export const disableShare = async (sessionId: string) =>
  (await apiClient.delete<ApiOk<SessionShare | null>>(`/sessions/${sessionId}/share`)).data.data;

export const deleteSession = async (sessionId: string) => {
  await apiClient.delete(`/sessions/${sessionId}`);
};

// ---------- Exports ----------

/** The error body of a failed blob request is a Blob: read its JSON `message` / `code`. */
export async function readBlobError(err: unknown): Promise<{ message?: string; code?: string } | null> {
  if (!axios.isAxiosError(err) || !(err.response?.data instanceof Blob)) return null;
  try {
    const body = JSON.parse(await err.response.data.text()) as { message?: unknown; code?: unknown };
    return {
      message: typeof body.message === "string" ? body.message : undefined,
      code: typeof body.code === "string" ? body.code : undefined,
    };
  } catch {
    return null;
  }
}

/** File name from a `Content-Disposition: attachment; filename="…"` header. */
export function fileNameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header !== "string") return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

/** Downloads one export through the browser (the API needs the bearer token, so no plain link). */
export async function downloadExport(sessionId: string, format: ExportFormat, fallbackName: string) {
  const res = await apiClient.get<Blob>(`/sessions/${sessionId}/export.${format}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFromDisposition(res.headers["content-disposition"], fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Public (no account) ----------

/** Plain client: no bearer token, no workspace header, no refresh-and-logout on 401. */
const publicClient: AxiosInstance = axios.create({ baseURL: getApiBaseUrl() });

export const getPublicResults = async (token: string) =>
  (await publicClient.get<ApiOk<PublicResults>>(`/public/results/${encodeURIComponent(token)}`)).data.data;

export const getTakeHome = async (sessionId: string, participantId: string, token: string) =>
  (
    await publicClient.get<ApiOk<TakeHome>>(`/sessions/${encodeURIComponent(sessionId)}/me`, {
      params: { participantId, token },
    })
  ).data.data;
