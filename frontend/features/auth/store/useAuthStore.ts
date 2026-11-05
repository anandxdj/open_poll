import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from '@/lib/api-client';

/** The signed-in user as GET /api/auth/me (and PATCH /api/me, the login response) sends it. */
export interface User {
  _id: string;
  email: string;
  name: string;
  picture?: string;
  /** False for accounts that sign in only with Google or SSO; absent on sessions stored before it existed. */
  hasPassword?: boolean;
  /** Linked sign-in providers (`google`, `oidc`, `saml`, `oidc_ws`). */
  identities?: { provider: string }[];
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

const SESSION_COOKIE = 'auth_session=1; path=/; max-age=604800; samesite=lax';

function setSessionCookie(active: boolean) {
  if (typeof document === 'undefined') return;
  document.cookie = active
    ? SESSION_COOKIE
    : 'auth_session=; path=/; max-age=0; samesite=lax';
}

const hasSessionCookie = () =>
  typeof document !== 'undefined' && document.cookie.split('; ').includes('auth_session=1');

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: true,

      setToken: (token) => {
        setSessionCookie(!!token);
        set({ accessToken: token, isAuthenticated: !!token });
      },
      setUser: (user) => set({ user }),

      logout: async () => {
        try {
          await axios.post('/auth/logout');
        } catch (error) {
          console.error('Logout failed:', error);
        } finally {
          setSessionCookie(false);
          set({ user: null, accessToken: null, isAuthenticated: false });
        }
      },

      checkAuth: async () => {
        // Never signed in here (no token, no session cookie): skip /auth/me, which would
        // fail into refresh-token and logout calls. Audiences on shared Wi-Fi share one IP,
        // and those calls count against the per-IP auth rate limits.
        if (!get().accessToken && !hasSessionCookie()) {
          set({ user: null, isAuthenticated: false, isLoading: false });
          return false;
        }
        try {
          set({ isLoading: true });
          const response = await axios.get('/auth/me');
          set({
            user: response.data.data,
            isAuthenticated: true,
            isLoading: false,
          });
          setSessionCookie(true);
          return true;
        } catch {
          setSessionCookie(false);
          set({ user: null, isAuthenticated: false, isLoading: false });
          return false;
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.accessToken;
          state.isLoading = true;
        }
      },
    },
  ),
);
