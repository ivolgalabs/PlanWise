import { create } from "zustand";
import type { Task } from "./api";

export type ViewKind = "day" | "week" | "month";
export type ThemeMode = "light" | "dark" | "system";

interface PlannerState {
  selectedDate: Date;
  view: ViewKind;
  tasks: Task[];
  mondayFirst: boolean;
  /** Режим темы: light/dark/system. */
  themeMode: ThemeMode;
  /** id предпочитаемой светлой темы ("light-slate"). */
  preferredLightTheme: string;
  /** id предпочитаемой тёмной темы ("dark-slate" или "oled-slate"). */
  preferredDarkTheme: string;
  /** Использовать OLED для тёмного режима. */
  useOledForDarkMode: boolean;
  /** Масштаб интерфейса 0.7-2.0. */
  uiScale: number;
  setSelectedDate: (d: Date) => void;
  setView: (v: ViewKind) => void;
  setTasks: (t: Task[]) => void;
  toggleMondayFirst: () => void;
  setThemeMode: (m: ThemeMode) => void;
  setPreferredLightTheme: (t: string) => void;
  setPreferredDarkTheme: (t: string) => void;
  setUseOledForDarkMode: (v: boolean) => void;
  setUiScale: (s: number) => void;
}

export const useStore = create<PlannerState>((set) => ({
  selectedDate: new Date(),
  view: "week",
  tasks: [],
  mondayFirst: true,
  themeMode: "system",
  preferredLightTheme: "light-slate",
  preferredDarkTheme: "dark-slate",
  useOledForDarkMode: false,
  uiScale: 1.0,
  setSelectedDate: (d) => set({ selectedDate: d }),
  setView: (v) => set({ view: v }),
  setTasks: (t) => set({ tasks: t }),
  toggleMondayFirst: () => set((s) => ({ mondayFirst: !s.mondayFirst })),
  setThemeMode: (m) => set({ themeMode: m }),
  setPreferredLightTheme: (t) => set({ preferredLightTheme: t }),
  setPreferredDarkTheme: (t) => set({ preferredDarkTheme: t }),
  setUseOledForDarkMode: (v) => set({ useOledForDarkMode: v }),
  setUiScale: (s) => set({ uiScale: s }),
}));
