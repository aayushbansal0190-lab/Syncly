import { create } from "zustand";
import type { Theme } from "../constants";

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  // Default to "cupcake": a soft, light pastel palette shown to first-time
  // visitors. Users can still switch to any theme; their choice is remembered
  // in localStorage and takes precedence over this default.
  theme: (localStorage.getItem("chat-theme") as Theme) || "cupcake",
  setTheme: (theme) => {
    localStorage.setItem("chat-theme", theme);
    set({ theme });
  },
}));
