import { create } from "zustand";
import api, { TOKEN_STORAGE_KEY } from "../services/api";
import { setItem, deleteItem } from "../lib/storage";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isOAuthProcessing: boolean;
  isAuthenticated: boolean;
  accessMessage: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setOAuthProcessing: (processing: boolean) => void;
  setAccessMessage: (message: string | null) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,
  isOAuthProcessing: false,
  isAuthenticated: false,
  accessMessage: null,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  setToken: async (token) => {
    if (token) {
      await setItem(TOKEN_STORAGE_KEY, token);
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      await deleteItem(TOKEN_STORAGE_KEY);
      delete api.defaults.headers.common.Authorization;
    }
    set({ token });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setOAuthProcessing: (processing) => set({ isOAuthProcessing: processing }),

  setAccessMessage: (message) => set({ accessMessage: message }),

  logout: async () => {
    await deleteItem(TOKEN_STORAGE_KEY);
    delete api.defaults.headers.common.Authorization;
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isOAuthProcessing: false,
      accessMessage: null,
    });
  },
}));
