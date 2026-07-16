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
  timeMinutes?: number | null; // 0-1439, null = «в течение дня»
}

export interface ColorSet {
  id: string;
  name: string;
  color: number;
  sortOrder: number;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  isDone: boolean;
  sortOrder: number;
  createdAt: number;
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
        timeMinutes: task.timeMinutes ?? null,
      },
    }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),
  moveTask: (id: string, newDate: Date) =>
    invoke<void>("move_task", { id, newDate: toEpochDay(newDate) }),
  getColorSets: () => invoke<ColorSet[]>("get_color_sets"),
  /** Перенести невыполненные прошлые задачи на сегодня. Возвращает кол-во. */
  rolloverOverdue: (today: Date) =>
    invoke<number>("rollover_overdue", { todayEpochDay: toEpochDay(today) }),
  getSubtasks: (taskId: string) =>
    invoke<Subtask[]>("get_subtasks", { taskId }),
  upsertSubtask: (sub: Partial<Subtask> & { taskId: string; title: string }) =>
    invoke<Subtask>("upsert_subtask", {
      sub: {
        id: sub.id ?? "",
        taskId: sub.taskId,
        title: sub.title,
        isDone: sub.isDone ?? false,
        sortOrder: sub.sortOrder ?? Date.now(),
        createdAt: sub.createdAt ?? 0,
      },
    }),
  deleteSubtask: (id: string) => invoke<void>("delete_subtask", { id }),
};
