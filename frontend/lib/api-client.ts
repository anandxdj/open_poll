import axios from 'axios';
import { getApiBaseUrl } from './env';
import { useAuthStore } from '@/features/auth/store/useAuthStore';
import { WORKSPACE_HEADER, workspaceHeaderValue } from '@/features/workspaces/store/selection';
import { useWorkspaceStore } from '@/features/workspaces/store/useWorkspaceStore';

export const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach token and the selected workspace
apiClient.interceptors.request.use((config) => {
  const { accessToken: token, user } = useAuthStore.getState();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const workspaceId = workspaceHeaderValue(useWorkspaceStore.getState(), user?._id);
  if (workspaceId && !config.headers.has(WORKSPACE_HEADER)) {
    config.headers.set(WORKSPACE_HEADER, workspaceId);
  }
  return config;
});

// Response interceptor: handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    // The selected workspace is no longer ours (removed, suspended, deleted): drop the
    // selection so the default workspace is used, and replay reads there once. Writes are
    // not replayed: they would land in a workspace the user did not choose.
    if (
      error.response?.status === 403 &&
      error.response.data?.code === 'WORKSPACE_FORBIDDEN' &&
      originalRequest?.headers?.has(WORKSPACE_HEADER) &&
      !originalRequest._workspaceRetry
    ) {
      useWorkspaceStore.getState().clearSelection();
      const method = (originalRequest.method ?? 'get').toLowerCase();
      if (method === 'get' || method === 'head') {
        originalRequest._workspaceRetry = true;
        originalRequest.headers.delete(WORKSPACE_HEADER);
        return apiClient(originalRequest);
      }
    }
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const res = await axios.post(`${getApiBaseUrl()}/auth/refresh-token`, {}, { withCredentials: true });
        const { accessToken } = res.data.data;
        useAuthStore.getState().setToken(accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;

// We can add interceptors here later if we implement Auth tokens