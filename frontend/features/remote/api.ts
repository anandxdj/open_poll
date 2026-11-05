import { apiClient } from "@/lib/api-client";
import type { RemoteState } from "@/features/presentations/types";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** Header carrying this phone's device key: the first device to present a pairing binds it. */
export const REMOTE_DEVICE_HEADER = "X-Remote-Device";

/** `GET /api/remote/:token/state` — what the remote shows. 404 `REMOTE_INVALID`, 403 `REMOTE_BOUND`. */
export const getRemoteState = async (token: string, deviceKey: string) =>
  (
    await apiClient.get<ApiOk<RemoteState>>(`/remote/${encodeURIComponent(token)}/state`, {
      headers: { [REMOTE_DEVICE_HEADER]: deviceKey },
    })
  ).data.data;

const DEVICE_KEY = "openpoll_remote_device";

const randomKey = () => {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * This phone's remote device key (48 hex characters), kept in localStorage so a
 * reload stays the same device. In blocked storage a key lives for this page
 * only: a reload then counts as another device and is refused once bound.
 */
export function remoteDeviceKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[0-9a-f]{48}$/.test(existing)) return existing;
    const key = randomKey();
    localStorage.setItem(DEVICE_KEY, key);
    return key;
  } catch {
    return (memoryKey ??= randomKey());
  }
}

let memoryKey: string | null = null;
