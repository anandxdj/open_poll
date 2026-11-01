import { apiClient } from "@/lib/api-client";
import type { User } from "@/features/auth/store/useAuthStore";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** `PATCH /api/me`: resolves with the updated user (the GET /api/auth/me shape). */
export const updateProfile = async (input: { name: string }) =>
  (await apiClient.patch<ApiOk<User>>("/me", input)).data.data;

/**
 * `POST /api/me/password`. Every other session ends; this one continues with
 * the returned access token (the refresh cookie is replaced by the response).
 * 400 WRONG_PASSWORD, 409 NO_PASSWORD.
 */
export const changePassword = async (input: { currentPassword: string; newPassword: string }) =>
  (await apiClient.post<ApiOk<{ user: User; accessToken: string }>>("/me/password", input)).data.data;
