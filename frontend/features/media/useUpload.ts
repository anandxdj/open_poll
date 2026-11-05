"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { getApiErrorMessage } from "@/lib/api-error";

// Browser uploads to object storage: presign → PUT straight to the bucket →
// complete (the API checks the stored object and records a MediaAsset).
// Contract: backend/docs/wiki/platform/storage.md. Only when
// `capabilities.storage` is true; otherwise presign answers 503.

export type UploadPurpose = "slide_image" | "slide_video" | "import_source" | "brand_logo" | "brand_background";

const MB = 1024 * 1024;

/** What each purpose accepts (mirrors backend `uploads.schema.ts`; SVG is never allowed). */
export const UPLOAD_RULES: Record<UploadPurpose, { types: readonly string[]; maxBytes: number }> = {
  slide_image: { types: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"], maxBytes: 10 * MB },
  slide_video: { types: ["video/mp4", "video/webm"], maxBytes: 200 * MB },
  brand_logo: { types: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"], maxBytes: 2 * MB },
  brand_background: { types: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"], maxBytes: 10 * MB },
  import_source: {
    types: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/pdf"],
    maxBytes: 100 * MB,
  },
};

/** The stored file, as `POST /api/uploads/complete` returns it. */
export interface UploadedMedia {
  key: string;
  url: string;
  mime: string;
  bytes: number;
}

interface PresignedUpload {
  key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
}

type ApiOk<T> = { success: boolean; message: string; data: T };

/** Why `file` cannot be uploaded for `purpose`, or null when it can. */
export function checkUploadFile(purpose: UploadPurpose, file: Pick<File, "type" | "size">): string | null {
  const rule = UPLOAD_RULES[purpose];
  if (!rule.types.includes(file.type)) {
    const kinds = rule.types.map((type) => type.split("/")[1]!.toUpperCase()).join(", ");
    return `This file type is not supported. Use ${kinds}.`;
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > rule.maxBytes) return `This file is too large (max ${Math.round(rule.maxBytes / MB)} MB).`;
  return null;
}

/** PUT with upload progress (fetch cannot report it). */
function putFile(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage answered ${xhr.status} to the upload.`));
    xhr.onerror = () => reject(new Error("The file could not be sent to storage."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Uploads one file and returns the stored media. Throws with a readable message. */
export async function uploadFile(
  purpose: UploadPurpose,
  file: File,
  { onProgress = () => {}, signal = new AbortController().signal } = {} as {
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  }
): Promise<UploadedMedia> {
  const problem = checkUploadFile(purpose, file);
  if (problem) throw new Error(problem);

  const presigned = (
    await apiClient.post<ApiOk<PresignedUpload>>("/uploads/presign", { purpose, mime: file.type, bytes: file.size })
  ).data.data;
  await putFile(presigned.url, file, presigned.headers, onProgress, signal);
  const asset = (await apiClient.post<ApiOk<UploadedMedia>>("/uploads/complete", { key: presigned.key })).data.data;
  return { key: asset.key, url: asset.url, mime: asset.mime, bytes: asset.bytes };
}

export interface UploadState {
  uploading: boolean;
  /** 0–1 while uploading. */
  progress: number;
  error: string | null;
}

const IDLE: UploadState = { uploading: false, progress: 0, error: null };

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * Upload state for one picker. `upload(file)` resolves with the stored media,
 * or null when it failed (see `error`) or was cancelled. Unmounting cancels
 * an upload in flight.
 */
export function useUpload(purpose: UploadPurpose) {
  const [state, setState] = useState<UploadState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const upload = useCallback(
    async (file: File): Promise<UploadedMedia | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ uploading: true, progress: 0, error: null });
      try {
        const media = await uploadFile(purpose, file, {
          signal: controller.signal,
          onProgress: (progress) => setState((s) => ({ ...s, progress })),
        });
        if (controllerRef.current === controller) setState(IDLE);
        return media;
      } catch (error) {
        if (controllerRef.current === controller) {
          setState(
            isAbort(error)
              ? IDLE
              : {
                  uploading: false,
                  progress: 0,
                  error: getApiErrorMessage(error) ?? (error instanceof Error ? error.message : "Upload failed."),
                }
          );
        }
        return null;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [purpose]
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, upload, cancel, reset };
}
