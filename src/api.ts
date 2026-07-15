import { invoke } from "@tauri-apps/api/core";

export interface Task {
  id: string;
  title: string;
  date: number; // epoch-day
  isDone: boolean;
  colorSetId: string | null;
  sortOrder: number;
  createdAt: number; // epoch-ms
  updatedAt: number;
  deviceId: string;
}

export interface ColorSet {
  id: string;
  name: string;
  color: number; // ARGB
  sortOrder: number;
}

/** epoch-day <-> Date. Должно совпадать с Rust-логикой хранения. */
export const toEpochDay = (d: Date): number => {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(utc / 86_400_000);
};

export const fromEpochDay = (n: number): Date => {
  const ms = n * 86_400_000;
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const api = {
  getTasks: (start: Date, end: Date) =>
    invoke<Task[]>("get_tasks", {
      startDay: toEpochDay(start),
      endDay: toEpochDay(end),
    }),
  upsertTask: (task: Partial<Task> & { title: string; date: number }) =>
    invoke<Task>("upsert_task", {
      task: {
        id: task.id ?? "",
        title: task.title,
        date: task.date,
        isDone: task.isDone ?? false,
        colorSetId: task.colorSetId ?? null,
        sortOrder: task.sortOrder ?? Date.now(),
        createdAt: task.createdAt ?? 0,
        updatedAt: 0,
        deviceId: task.deviceId ?? "",
      },
    }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),
  moveTask: (id: string, newDate: Date) =>
    invoke<void>("move_task", { id, newDate: toEpochDay(newDate) }),
  getColorSets: () => invoke<ColorSet[]>("get_color_sets"),
  /** Перенести невыполненные прошлые задачи на сегодня. Возвращает кол-во. */
  rolloverOverdue: (today: Date) =>
    invoke<number>("rollover_overdue", { todayEpochDay: toEpochDay(today) }),
};
