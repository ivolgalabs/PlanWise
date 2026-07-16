import { create } from "zustand";
import type { Task } from "./api";
import type { ModePref } from "./theme";

export type ViewKind = "day" | "week" | "month";

interface PlannerState {
  selectedDate: Date;
  view: ViewKind;
  tasks: Task[];
  mondayFirst: boolean;
  /** Палитра Universal UI (slate/sepia/...). */
  palette: string;
  /** Режим темы: light/dark/auto. */
  modePref: ModePref;
  /** Масштаб интерфейса: sm/md/lg/xl. */
  scale: string;
  setSelectedDate: (d: Date) => void;
  setView: (v: ViewKind) => void;
  setTasks: (t: Task[]) => void;
  toggleMondayFirst: () => void;
  setPalette: (p: string) => void;
  setModePref: (m: ModePref) => void;
  setScale: (s: string) => void;
}

export const useStore = create<PlannerState>((set) => ({
  selectedDate: new Date(),
  view: "week",
  tasks: [],
  mondayFirst: true,
  palette: "slate",
  modePref: "auto",
  scale: "md",
  setSelectedDate: (d) => set({ selectedDate: d }),
  setView: (v) => set({ view: v }),
  setTasks: (t) => set({ tasks: t }),
  toggleMondayFirst: () => set((s) => ({ mondayFirst: !s.mondayFirst })),
  setPalette: (p) => set({ palette: p }),
  setModePref: (m) => set({ modePref: m }),
  setScale: (s) => set({ scale: s }),
}));
