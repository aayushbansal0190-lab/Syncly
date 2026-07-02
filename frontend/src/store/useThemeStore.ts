import { create } from "zustand";
import type { Theme } from "../constants";

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  // Default to "nord": a clean, muted blue-grey palette suited to a modern,
  // minimal UI. Users can still switch to any theme; their choice is remembered
  // in localStorage and takes precedence over this default.
  theme: (localStorage.getItem("chat-theme") as Theme) || "nord",
  setTheme: (theme) => {
    localStorage.setItem("chat-theme", theme);
    set({ theme });
  },
}));
