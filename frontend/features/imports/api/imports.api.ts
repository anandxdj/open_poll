import axios from "axios";
import { apiClient } from "@/lib/api-client";
import { uploadFile } from "@/features/media/useUpload";
import type { ImportJob, QuestionsResult, SourceKind } from "../types";
import { SOURCE_MIME } from "../logic";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** The API's machine-readable error code (`STORAGE_DISABLED`, `PLAN_LIMIT_REACHED`, …), if the error has one. */
export function getImportErrorCode(error: unknown): string | undefined {
  if (!axios.isAxiosError<{ code?: unknown }>(error)) return undefined;
  const code = error.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}

/** Uploads a PPTX/PDF through the presign flow (purpose `import_source`) and returns its storage key. */
export async function uploadImportSource(
  file: File,
  kind: SourceKind,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}
): Promise<string> {
  // Some browsers leave .pptx files untyped; the upload must declare the type the server expects.
  const typed = file.type === SOURCE_MIME[kind] ? file : new File([file], file.name, { type: SOURCE_MIME[kind] });
  const media = await uploadFile("import_source", typed, options);
  return media.key;
}

export type CreateImportBody =
  | { kind: SourceKind; key: string; title?: string }
  | { kind: "gslides"; url: string; title?: string };

export const createImport = async (body: CreateImportBody) =>
  (await apiClient.post<ApiOk<ImportJob>>("/imports", body)).data.data;

export const getImport = async (id: string) => (await apiClient.get<ApiOk<ImportJob>>(`/imports/${id}`)).data.data;

export interface QuestionsRequest {
  file: File;
  mode: "preview" | "import";
  title?: string;
  /** Append to this deck instead of creating one. */
  presentationId?: string;
}

/** CSV/XLSX questions: `preview` only checks the file, `import` creates (or extends) the deck. */
export async function sendQuestions({ file, mode, title, presentationId }: QuestionsRequest, signal?: AbortSignal) {
  const form = new FormData();
  form.append("mode", mode);
  if (title?.trim()) form.append("title", title.trim());
  if (presentationId) form.append("presentationId", presentationId);
  form.append("file", file);
  const response = await apiClient.post<ApiOk<QuestionsResult>>("/imports/questions", form, {
    // The instance defaults to JSON; the browser adds the multipart boundary.
    headers: { "Content-Type": "multipart/form-data" },
    signal,
  });
  return response.data.data;
}

/** Downloads a question template through the API client and hands it to the browser as a file. */
export async function downloadQuestionsTemplate(format: "csv" | "xlsx"): Promise<void> {
  const response = await apiClient.get<Blob>(`/imports/templates/questions.${format}`, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `openpoll-questions-template.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
