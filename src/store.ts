import { create } from "zustand";
import type { Task } from "./api";

export type ViewKind = "day" | "week" | "month";

interface PlannerState {
  selectedDate: Date;
  view: ViewKind;
  tasks: Task[];
  mondayFirst: boolean;
  setSelectedDate: (d: Date) => void;
  setView: (v: ViewKind) => void;
  setTasks: (t: Task[]) => void;
  toggleMondayFirst: () => void;
}

export const useStore = create<PlannerState>((set) => ({
  selectedDate: new Date(),
  view: "week",
  tasks: [],
  mondayFirst: true,
  setSelectedDate: (d) => set({ selectedDate: d }),
  setView: (v) => set({ view: v }),
  setTasks: (t) => set({ tasks: t }),
  toggleMondayFirst: () => set((s) => ({ mondayFirst: !s.mondayFirst })),
}));
