import { create } from "zustand";
import { TOKEN_STORAGE_KEY } from "../services/api";
import { setItem, deleteItem } from "../lib/storage";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => Promise<void>;
  setLoading: (loading: boolean) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  setToken: async (token) => {
    if (token) {
      await setItem(TOKEN_STORAGE_KEY, token);
    } else {
      await deleteItem(TOKEN_STORAGE_KEY);
    }
    set({ token });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  logout: async () => {
    await deleteItem(TOKEN_STORAGE_KEY);
    set({ user: null, token: null, isAuthenticated: false });
  },
}));
