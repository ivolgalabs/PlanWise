import { invoke } from "@tauri-apps/api/core";
import { browserApi } from "./api-browser-fallback";

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
  notes: string; // заметка, '' = нет
  someday: boolean; // «Когда-нибудь»: задача без привязки ко дню
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

/** Доступен ли Tauri-рантайм (иначе используем браузерный фоллбек). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

export const api = {
  getTasks: (start: Date, end: Date) => {
    const startDay = toEpochDay(start), endDay = toEpochDay(end);
    return isTauri()
      ? invoke<Task[]>("get_tasks", { startDay, endDay })
      : browserApi.getTasks(startDay, endDay);
  },
  upsertTask: (task: Partial<Task> & { title: string; date: number }) => {
    const t = {
      id: task.id ?? "", title: task.title, date: task.date,
      isDone: task.isDone ?? false, colorSetId: task.colorSetId ?? null,
      sortOrder: task.sortOrder ?? Date.now(), createdAt: task.createdAt ?? 0,
      updatedAt: 0, deviceId: task.deviceId ?? "", timeMinutes: task.timeMinutes ?? null,
      notes: task.notes ?? "",
      someday: task.someday ?? false,
    };
    return isTauri() ? invoke<Task>("upsert_task", { task: t }) : browserApi.upsertTask(t);
  },
  deleteTask: (id: string) => (isTauri() ? invoke<void>("delete_task", { id }) : browserApi.deleteTask(id)),
  moveTask: (id: string, newDate: Date) => {
    const nd = toEpochDay(newDate);
    return isTauri() ? invoke<void>("move_task", { id, newDate: nd }) : browserApi.moveTask(id, nd);
  },
  /** Задачи «Когда-нибудь» (без даты). */
  getSomedayTasks: () => (isTauri() ? invoke<Task[]>("get_someday_tasks") : browserApi.getSomedayTasks()),
  /** Переместить задачу в «Когда-нибудь» (дата сбрасывается). */
  setSomeday: (id: string) => (isTauri() ? invoke<void>("set_someday", { id }) : browserApi.setSomeday(id)),
  getColorSets: () => (isTauri() ? invoke<ColorSet[]>("get_color_sets") : browserApi.getColorSets()),
  /** Создать/обновить категорию. Пустой id — новая категория (id сгенерит Rust). */
  upsertColorSet: (set: Partial<ColorSet> & { name: string; color: number }) => {
    const s = { id: set.id ?? "", name: set.name, color: set.color, sortOrder: set.sortOrder ?? Date.now() };
    return isTauri() ? invoke<ColorSet>("upsert_color_set", { set: s }) : browserApi.upsertColorSet(s);
  },
  /** Удалить категорию; задачи с ней становятся без категории. */
  deleteColorSet: (id: string) => (isTauri() ? invoke<void>("delete_color_set", { id }) : browserApi.deleteColorSet(id)),
  /** Перенести невыполненные прошлые задачи на сегодня. Возвращает кол-во. */
  rolloverOverdue: (today: Date) => {
    const td = toEpochDay(today);
    return isTauri() ? invoke<number>("rollover_overdue", { todayEpochDay: td }) : browserApi.rolloverOverdue(td);
  },
  getSubtasks: (taskId: string) => (isTauri() ? invoke<Subtask[]>("get_subtasks", { taskId }) : browserApi.getSubtasks(taskId)),
  upsertSubtask: (sub: Partial<Subtask> & { taskId: string; title: string }) => {
    const s = { id: sub.id ?? "", taskId: sub.taskId, title: sub.title, isDone: sub.isDone ?? false, sortOrder: sub.sortOrder ?? Date.now(), createdAt: sub.createdAt ?? 0 };
    return isTauri() ? invoke<Subtask>("upsert_subtask", { sub: s }) : browserApi.upsertSubtask(s);
  },
  deleteSubtask: (id: string) => (isTauri() ? invoke<void>("delete_subtask", { id }) : browserApi.deleteSubtask(id)),
};
