import { create } from "zustand";
import type { Task } from "./api";

export type ViewKind = "day" | "week" | "month";

interface PlannerState {
  selectedDate: Date;
  view: ViewKind;
  tasks: Task[];
  mondayFirst: boolean;
  /** id темы Universal UI (напр. 'light-slate'). */
  theme: string;
  /** Масштаб интерфейса: sm/md/lg/xl. */
  scale: string;
  setSelectedDate: (d: Date) => void;
  setView: (v: ViewKind) => void;
  setTasks: (t: Task[]) => void;
  toggleMondayFirst: () => void;
  setTheme: (t: string) => void;
  setScale: (s: string) => void;
}

export const useStore = create<PlannerState>((set) => ({
  selectedDate: new Date(),
  view: "week",
  tasks: [],
  mondayFirst: true,
  theme: "light-slate",
  scale: "md",
  setSelectedDate: (d) => set({ selectedDate: d }),
  setView: (v) => set({ view: v }),
  setTasks: (t) => set({ tasks: t }),
  toggleMondayFirst: () => set((s) => ({ mondayFirst: !s.mondayFirst })),
  setTheme: (t) => set({ theme: t }),
  setScale: (s) => set({ scale: s }),
}));
