import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Task, ColorSet } from "./api";
import type { CustomSlot, ThemePreset } from "./theme";

export type ViewKind = "day" | "week" | "month";
export type ThemeMode = "light" | "dark" | "system";
/** Режим сортировки задач внутри дня/недели/месяца. */
export type SortMode = "time" | "manual" | "priority";

/** Шаблон быстрой задачи: кнопка «+ Шаблон» в дне/неделе создаёт задачу
 *  с этими параметрами. Хранится в настройках (persist). */
export interface TaskPattern {
  id: string;
  title: string;
  timeMinutes: number | null;
  /** Сложность: 0=не задана, 1=лёгкая, 2=средняя, 3=сложная. */
  difficulty: number;
  durationMinutes: number | null;
  /** Своё уведомление шаблона (null = по умолчанию). */
  notifyMinutes?: number | null;
}

/** Флаги видимости элементов интерфейса (настройки → «Интерфейс»). */
export interface VisibilityState {
  navArrows: boolean; search: boolean; datePicker: boolean;
  miniCalendar: boolean; taskTime: boolean; subtasks: boolean; notes: boolean;
  someday: boolean;
  taskActions: boolean; archiveBanner: boolean;
}

/** Видимость по умолчанию — все элементы показаны. */
const DEFAULT_VISIBILITY: VisibilityState = {
  navArrows: true, search: true, datePicker: true, miniCalendar: true,
  taskTime: true, subtasks: true, notes: true, someday: true, taskActions: true, archiveBanner: true,
};
export { DEFAULT_VISIBILITY };

interface PlannerState {
  selectedDate: Date;
  /** Якорь недели: позиция, на которой остановился вид «Неделя». Выбор дня
   *  в «Дне» не двигает неделю (у каждого вида свой якорь; null = ещё не
   *  открывался — показывается selectedDate). */
  weekDate: Date | null;
  /** Якорь месяца — аналогично weekDate для вида «Месяц». */
  monthDate: Date | null;
  view: ViewKind;
  tasks: Task[];
  /** Задачи «Архива» (скрыты из видов, ждут возврата) — отдельным пулом. */
  archivedTasks: Task[];
  mondayFirst: boolean;
  /** Режим темы: light/dark/system. */
  themeMode: ThemeMode;
  /** id предпочитаемой светлой темы ("light-slate"). */
  preferredLightTheme: string;
  /** id предпочитаемой тёмной темы ("dark-slate" или "oled-slate"). */
  preferredDarkTheme: string;
  /** Использовать OLED для тёмного режима. */
  useOledForDarkMode: boolean;
  /** Слоты «Свой выбор»: перекрывают акцент/фон светлой/тёмной темы. */
  customLight: CustomSlot | null;
  customDark: CustomSlot | null;
  /** Библиотека «Мои стили». */
  presets: ThemePreset[];
  /** Ориентация недели по умолчанию: true — список (вертикально). */
  weekVertical: boolean;
  /** Масштаб интерфейса 0.7-2.0 (document.zoom — масштабирует весь UI). */
  uiScale: number;
  /** Множитель размера шрифта 0.8-1.6 (меняет --fs-* токены через html font-size). */
  fontScale: number;
  /** Авто-архив просроченных невыполненных задач (вкл/выкл). */
  archiveEnabled: boolean;
  /** Категории (цвет-сеты) из БД — грузятся при старте. */
  colorSets: ColorSet[];
  /** Видимость элементов интерфейса — можно прятать в настройках. */
  visibility: VisibilityState;
  /** Зазор между мини-календарём и «Когда-нибудь» в правой панели (px). */
  panelGap: number;
  /** Версия списков подзадач: bump после любого переноса/преобразования
   *  подзадачи (promote, смена родителя) — SubtaskList перезагружается,
   *  чтобы исчезнувшая подзадача не «зависала» у старого родителя. */
  subtaskRev: number;
  /** Уведомления: утренний список задач на день (включён, час). */
  notifyDaySummary: boolean;
  notifyDayHour: number;
  /** Напоминания перед задачами со временем (включены, за сколько минут —
   *  массив: можно выбрать сразу несколько интервалов). */
  notifyReminders: boolean;
  notifyRemindMinutes: number[];
  /** Быстрые пресеты времени (минуты с 00:00) — кнопки в выборе времени.
   *  Пользователь настраивает свой список в настройках. */
  timePresets: number[];
  /** Шаблоны быстрых задач — кнопки «+ Шаблон» в дне/неделе. */
  taskPatterns: TaskPattern[];
  /** Сортировка задач в дне/неделе/месяце: time — по времени, manual —
   *  ручной порядок (sortOrder), priority — по приоритету (высокие сверху). */
  sortMode: SortMode;
  /** Запрещать создание задачи на время, занятое другой задачей
   *  (настройка хранится в БД, см. get_settings/set_settings). */
  preventOverlaps: boolean;
  /** Авто-выполнение: если время задачи уже прошло (дата в прошлом или
   *  сегодня и время ≤ текущего) — задача автоматически выполнена;
   *  время в будущем — снимает выполнение. Применяется при установке времени. */
  autoDonePastTime: boolean;
  setSelectedDate: (d: Date) => void;
  setWeekDate: (d: Date) => void;
  setMonthDate: (d: Date) => void;
  setView: (v: ViewKind) => void;
  setTasks: (t: Task[]) => void;
  setArchivedTasks: (t: Task[]) => void;
  setColorSets: (s: ColorSet[]) => void;
  toggleMondayFirst: () => void;
  setThemeMode: (m: ThemeMode) => void;
  setPreferredLightTheme: (t: string) => void;
  setPreferredDarkTheme: (t: string) => void;
  setUseOledForDarkMode: (v: boolean) => void;
  setCustomLight: (s: CustomSlot | null) => void;
  setCustomDark: (s: CustomSlot | null) => void;
  setPresets: (p: ThemePreset[]) => void;
  setWeekVertical: (v: boolean) => void;
  setUiScale: (s: number) => void;
  setFontScale: (s: number) => void;
  setArchiveEnabled: (v: boolean) => void;
  setVisibility: (k: keyof VisibilityState, v: boolean) => void;
  setPanelGap: (v: number) => void;
  bumpSubtasks: () => void;
  setNotifyDaySummary: (v: boolean) => void;
  setNotifyDayHour: (v: number) => void;
  setNotifyReminders: (v: boolean) => void;
  /** Переключить интервал напоминания (добавить/убрать из массива). */
  setNotifyRemindMinutes: (v: number) => void;
  /** Добавить/убрать быстрый пресет времени (минуты). */
  toggleTimePreset: (m: number) => void;
  /** Заменить весь список шаблонов задач. */
  setTaskPatterns: (p: TaskPattern[]) => void;
  setSortMode: (m: SortMode) => void;
  setPreventOverlaps: (v: boolean) => void;
  setAutoDonePastTime: (v: boolean) => void;
}

export const useStore = create<PlannerState>()(
  // persist: сохраняем настройки UI между запусками. tasks и selectedDate
  // не персистим — задачи грузятся из SQLite, дата всегда стартует с сегодня.
  persist(
    (set) => ({
      selectedDate: new Date(),
      weekDate: null,
      monthDate: null,
      view: "week",
      tasks: [],
      mondayFirst: true,
      themeMode: "system",
      preferredLightTheme: "light-slate",
      preferredDarkTheme: "dark-slate",
      useOledForDarkMode: false,
      customLight: null,
      customDark: null,
      presets: [],
      weekVertical: true,
      uiScale: 1.0,
      fontScale: 1.0,
      archiveEnabled: true,
      archivedTasks: [],
      colorSets: [],
      visibility: DEFAULT_VISIBILITY,
      panelGap: 20,
      subtaskRev: 0,
      notifyDaySummary: true,
      notifyDayHour: 8,
      notifyReminders: true,
      notifyRemindMinutes: [60],
      timePresets: [9 * 60, 12 * 60, 15 * 60, 18 * 60, 21 * 60],
      taskPatterns: [],
      sortMode: "time",
      preventOverlaps: true,
      autoDonePastTime: true,
      setSelectedDate: (d) => set({ selectedDate: d }),
      setWeekDate: (d) => set({ weekDate: d }),
      setMonthDate: (d) => set({ monthDate: d }),
      setView: (v) => set({ view: v }),
      setTasks: (t) => set({ tasks: t }),
      setArchivedTasks: (t) => set({ archivedTasks: t }),
      setColorSets: (s) => set({ colorSets: s }),
      toggleMondayFirst: () => set((s) => ({ mondayFirst: !s.mondayFirst })),
      setThemeMode: (m) => set({ themeMode: m }),
      setPreferredLightTheme: (t) => set({ preferredLightTheme: t }),
      setPreferredDarkTheme: (t) => set({ preferredDarkTheme: t }),
      setUseOledForDarkMode: (v) => set({ useOledForDarkMode: v }),
      setCustomLight: (s) => set({ customLight: s }),
      setCustomDark: (s) => set({ customDark: s }),
      setPresets: (p) => set({ presets: p }),
      setWeekVertical: (v) => set({ weekVertical: v }),
      setUiScale: (s) => set({ uiScale: s }),
      setFontScale: (s) => set({ fontScale: s }),
      setArchiveEnabled: (v) => set({ archiveEnabled: v }),
      setVisibility: (k, v) =>
        set((s) => ({ visibility: { ...s.visibility, [k]: v } })),
      setPanelGap: (v) => set({ panelGap: v }),
      bumpSubtasks: () => set((s) => ({ subtaskRev: s.subtaskRev + 1 })),
      setNotifyDaySummary: (v) => set({ notifyDaySummary: v }),
      setNotifyDayHour: (v) => set({ notifyDayHour: v }),
      setNotifyReminders: (v) => set({ notifyReminders: v }),
      setNotifyRemindMinutes: (v) =>
        set((s) => ({
          notifyRemindMinutes: s.notifyRemindMinutes.includes(v)
            ? s.notifyRemindMinutes.filter((x) => x !== v)
            : [...s.notifyRemindMinutes, v],
        })),
      toggleTimePreset: (m) =>
        set((s) => ({
          timePresets: s.timePresets.includes(m)
            ? s.timePresets.filter((x) => x !== m)
            : [...s.timePresets, m].sort((a, b) => a - b),
        })),
      setTaskPatterns: (p) => set({ taskPatterns: p }),
      setSortMode: (m) => set({ sortMode: m }),
      setPreventOverlaps: (v) => set({ preventOverlaps: v }),
      setAutoDonePastTime: (v) => set({ autoDonePastTime: v }),
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
        customLight: s.customLight,
        customDark: s.customDark,
        presets: s.presets,
        weekVertical: s.weekVertical,
        uiScale: s.uiScale,
        fontScale: s.fontScale,
        archiveEnabled: s.archiveEnabled,
        visibility: s.visibility,
        panelGap: s.panelGap,
        notifyDaySummary: s.notifyDaySummary,
        notifyDayHour: s.notifyDayHour,
        notifyReminders: s.notifyReminders,
        notifyRemindMinutes: s.notifyRemindMinutes,
        timePresets: s.timePresets,
        taskPatterns: s.taskPatterns,
        sortMode: s.sortMode,
        autoDonePastTime: s.autoDonePastTime,
      }),
      // Дефолтный shallow-merge zustand заменяет visibility целиком —
      // новые флаги (например, notes) терялись бы у старых установок.
      // Мёржим visibility поверх дефолта + нормализуем старые форматы.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlannerState>;
        // Старые настройки хранили notifyRemindMinutes ЧИСЛОМ (одно значение);
        // теперь это массив — превращаем, иначе рендер настроек падает
        // (T.includes is not a function → белый экран при открытии).
        const rmm = Array.isArray(p.notifyRemindMinutes)
          ? p.notifyRemindMinutes
          : typeof p.notifyRemindMinutes === "number"
            ? [p.notifyRemindMinutes]
            : current.notifyRemindMinutes;
        // Аналогично: время-пресеты и шаблоны должны быть массивами.
        const tp = Array.isArray(p.timePresets) ? p.timePresets : current.timePresets;
        const pats = Array.isArray(p.taskPatterns) ? p.taskPatterns : current.taskPatterns;
        // Старая сортировка «по сложности» — теперь «по приоритету».
        const sm =
          (p.sortMode as string) === "difficulty"
            ? "priority"
            : (p.sortMode ?? current.sortMode);
        return {
          ...current,
          ...p,
          notifyRemindMinutes: rmm,
          timePresets: tp,
          taskPatterns: pats,
          sortMode: sm,
          visibility: {
            ...current.visibility,
            ...((p.visibility ?? {}) as Partial<VisibilityState>),
          },
        };
      },
    },
  ),
);
