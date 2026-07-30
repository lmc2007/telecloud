import { create } from "zustand";
import { api } from "../lib/api";

interface User {
  id: number;
  username: string;
  email: string | null;
  avatar_url: string | null;
  storage_used: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isChecking: boolean;
  error: string | null;

  login: (
    username: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<void>;
  register: (
    username: string,
    password: string,
    email?: string
  ) => Promise<void>;
  logout: () => void;
  autoLogin: () => Promise<void>;
  setUser: (user: User) => void;
  clearError: () => void;
}

const STORAGE_KEY_REFRESH = "tcd_refresh_token";
const STORAGE_KEY_ACCESS = "tcd_access_token";
const STORAGE_KEY_REMEMBER = "tcd_remember";

function saveTokens(access: string, refresh: string) {
  localStorage.setItem(STORAGE_KEY_ACCESS, access);
  localStorage.setItem(STORAGE_KEY_REFRESH, refresh);
  localStorage.setItem(STORAGE_KEY_REMEMBER, "1");
}

function loadRefreshToken(): string | null {
  if (localStorage.getItem(STORAGE_KEY_REMEMBER) !== "1") return null;
  return localStorage.getItem(STORAGE_KEY_REFRESH);
}

function clearTokens() {
  localStorage.removeItem(STORAGE_KEY_ACCESS);
  localStorage.removeItem(STORAGE_KEY_REFRESH);
  localStorage.removeItem(STORAGE_KEY_REMEMBER);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  isChecking: true,
  error: null,

  login: async (username, password, rememberMe) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<{
        success: boolean;
        data: {
          user: User;
          access_token: string;
          refresh_token: string;
        };
      }>("/auth/login", { username, password });

      const { user, access_token, refresh_token } = res.data;
      api.setToken(access_token);
      api.setRefreshToken(refresh_token);
      if (rememberMe !== false) saveTokens(access_token, refresh_token);
      set({
        user,
        accessToken: access_token,
        refreshToken: refresh_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "登录失败",
        isLoading: false,
      });
      throw err;
    }
  },

  register: async (username, password, email) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<{
        success: boolean;
        data: {
          user: User;
          access_token: string;
          refresh_token: string;
        };
      }>("/auth/register", { username, password, email });

      const { user, access_token, refresh_token } = res.data;
      api.setToken(access_token);
      api.setRefreshToken(refresh_token);
      saveTokens(access_token, refresh_token);
      set({
        user,
        accessToken: access_token,
        refreshToken: refresh_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "注册失败",
        isLoading: false,
      });
      throw err;
    }
  },

  logout: () => {
    api.setToken(null);
    api.setRefreshToken(null);
    clearTokens();
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  autoLogin: async () => {
    const rToken = loadRefreshToken();
    if (!rToken) {
      set({ isChecking: false });
      return;
    }

    try {
      const res = await api.post<{
        success: boolean;
        data: {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };
      }>("/auth/refresh", { refresh_token: rToken });

      const { access_token, refresh_token } = res.data;
      api.setToken(access_token);
      api.setRefreshToken(refresh_token);
      saveTokens(access_token, refresh_token);

      const userRes = await api.get<{ success: boolean; data: User }>(
        "/auth/me"
      );

      set({
        user: userRes.data,
        accessToken: access_token,
        refreshToken: refresh_token,
        isAuthenticated: true,
        isChecking: false,
      });
    } catch {
      clearTokens();
      api.setToken(null);
      set({ isChecking: false });
    }
  },

  setUser: (user) => set({ user }),
  clearError: () => set({ error: null }),
}));
