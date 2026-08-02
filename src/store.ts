import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Task, ColorSet } from "./api";

export type ViewKind = "day" | "week" | "month";
export type ThemeMode = "light" | "dark" | "system";

/** Флаги видимости элементов интерфейса (настройки → «Интерфейс»). */
export interface VisibilityState {
  navArrows: boolean; search: boolean; datePicker: boolean;
  miniCalendar: boolean; taskTime: boolean; subtasks: boolean; notes: boolean;
  someday: boolean;
  taskActions: boolean; rolloverBanner: boolean;
}

/** Видимость по умолчанию — все элементы показаны. */
const DEFAULT_VISIBILITY: VisibilityState = {
  navArrows: true, search: true, datePicker: true, miniCalendar: true,
  taskTime: true, subtasks: true, notes: true, someday: true, taskActions: true, rolloverBanner: true,
};

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
  /** Масштаб интерфейса 0.7-2.0 (document.zoom — масштабирует весь UI). */
  uiScale: number;
  /** Множитель размера шрифта 0.8-1.6 (меняет --fs-* токены через html font-size). */
  fontScale: number;
  /** Авто-перенос невыполненных прошлых задач на сегодня (вкл/выкл). */
  rolloverEnabled: boolean;
  /** Категории (цвет-сеты) из БД — грузятся при старте. */
  colorSets: ColorSet[];
  /** Видимость элементов интерфейса — можно прятать в настройках. */
  visibility: VisibilityState;
  setSelectedDate: (d: Date) => void;
  setView: (v: ViewKind) => void;
  setTasks: (t: Task[]) => void;
  setColorSets: (s: ColorSet[]) => void;
  toggleMondayFirst: () => void;
  setThemeMode: (m: ThemeMode) => void;
  setPreferredLightTheme: (t: string) => void;
  setPreferredDarkTheme: (t: string) => void;
  setUseOledForDarkMode: (v: boolean) => void;
  setUiScale: (s: number) => void;
  setFontScale: (s: number) => void;
  setRolloverEnabled: (v: boolean) => void;
  setVisibility: (k: keyof VisibilityState, v: boolean) => void;
}

export const useStore = create<PlannerState>()(
  // persist: сохраняем настройки UI между запусками. tasks и selectedDate
  // не персистим — задачи грузятся из SQLite, дата всегда стартует с сегодня.
  persist(
    (set) => ({
      selectedDate: new Date(),
      view: "week",
      tasks: [],
      mondayFirst: true,
      themeMode: "system",
      preferredLightTheme: "light-slate",
      preferredDarkTheme: "dark-slate",
      useOledForDarkMode: false,
      uiScale: 1.0,
      fontScale: 1.0,
      rolloverEnabled: true,
      colorSets: [],
      visibility: DEFAULT_VISIBILITY,
      setSelectedDate: (d) => set({ selectedDate: d }),
      setView: (v) => set({ view: v }),
      setTasks: (t) => set({ tasks: t }),
      setColorSets: (s) => set({ colorSets: s }),
      toggleMondayFirst: () => set((s) => ({ mondayFirst: !s.mondayFirst })),
      setThemeMode: (m) => set({ themeMode: m }),
      setPreferredLightTheme: (t) => set({ preferredLightTheme: t }),
      setPreferredDarkTheme: (t) => set({ preferredDarkTheme: t }),
      setUseOledForDarkMode: (v) => set({ useOledForDarkMode: v }),
      setUiScale: (s) => set({ uiScale: s }),
      setFontScale: (s) => set({ fontScale: s }),
      setRolloverEnabled: (v) => set({ rolloverEnabled: v }),
      setVisibility: (k, v) =>
        set((s) => ({ visibility: { ...s.visibility, [k]: v } })),
    }),
    {
      name: "todo-settings",
      // Сохраняем только настройки UI — без tasks и selectedDate.
      partialize: (s) => ({
        view: s.view,
        mondayFirst: s.mondayFirst,
        themeMode: s.themeMode,
        preferredLightTheme: s.preferredLightTheme,
        preferredDarkTheme: s.preferredDarkTheme,
        useOledForDarkMode: s.useOledForDarkMode,
        uiScale: s.uiScale,
        fontScale: s.fontScale,
        rolloverEnabled: s.rolloverEnabled,
        visibility: s.visibility,
      }),
      // Дефолтный shallow-merge zustand заменяет visibility целиком —
      // новые флаги (например, notes) терялись бы у старых установок.
      // Мёржим visibility поверх дефолта.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<PlannerState>),
        visibility: {
          ...current.visibility,
          ...((persisted as Partial<PlannerState>)?.visibility ?? {}),
        },
      }),
    },
  ),
);
