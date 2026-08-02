/**
 * Браузерный фоллбек API: используется, когда приложение открыто вне Tauri
 * (vite dev в обычном браузере). Реализует те же команды, что Rust, поверх
 * localStorage — чтобы UI можно было тестировать без сборки Rust.
 * Сортировки совпадают с commands.rs (время ASC → sortOrder ASC).
 */
import type { Task, ColorSet, Subtask } from "./api";

const K = { tasks: "fb:tasks", sets: "fb:sets", subs: "fb:subtasks" };

const load = <T,>(k: string): T[] => {
  try { return JSON.parse(localStorage.getItem(k) ?? "[]"); } catch { return []; }
};
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

const sortTasks = (arr: Task[]): Task[] =>
  arr.sort((a, b) => {
    const at = a.timeMinutes ?? 9999, bt = b.timeMinutes ?? 9999;
    return at - bt || a.sortOrder - b.sortOrder;
  });

export const browserApi = {
  async getTasks(startDay: number, endDay: number): Promise<Task[]> {
    return sortTasks(load<Task>(K.tasks).filter((t) => t.date >= startDay && t.date <= endDay));
  },
  async upsertTask(task: Task): Promise<Task> {
    const id = task.id || crypto.randomUUID();
    const rec: Task = { ...task, id, notes: task.notes ?? "" };
    const all = load<Task>(K.tasks).filter((t) => t.id !== id);
    all.push(rec);
    save(K.tasks, all);
    return rec;
  },
  async deleteTask(id: string): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).filter((t) => t.id !== id));
    save(K.subs, load<Subtask>(K.subs).filter((s) => s.taskId !== id));
  },
  async moveTask(id: string, newDay: number): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, date: newDay } : t)));
  },
  async getColorSets(): Promise<ColorSet[]> {
    return load<ColorSet>(K.sets).sort((a, b) => a.sortOrder - b.sortOrder);
  },
  async upsertColorSet(set: ColorSet): Promise<ColorSet> {
    const id = set.id || crypto.randomUUID();
    const all = load<ColorSet>(K.sets).filter((s) => s.id !== id);
    all.push({ ...set, id });
    save(K.sets, all);
    return { ...set, id };
  },
  async deleteColorSet(id: string): Promise<void> {
    save(K.sets, load<ColorSet>(K.sets).filter((s) => s.id !== id));
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.colorSetId === id ? { ...t, colorSetId: null } : t)));
  },
  async rolloverOverdue(todayDay: number): Promise<number> {
    let n = 0;
    save(K.tasks, load<Task>(K.tasks).map((t) => {
      if (t.date < todayDay && !t.isDone) { n++; return { ...t, date: todayDay }; }
      return t;
    }));
    return n;
  },
  async getSubtasks(taskId: string): Promise<Subtask[]> {
    return load<Subtask>(K.subs)
      .filter((s) => s.taskId === taskId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
  async upsertSubtask(sub: Subtask): Promise<Subtask> {
    const id = sub.id || crypto.randomUUID();
    const all = load<Subtask>(K.subs).filter((s) => s.id !== id);
    all.push({ ...sub, id });
    save(K.subs, all);
    return { ...sub, id };
  },
  async deleteSubtask(id: string): Promise<void> {
    save(K.subs, load<Subtask>(K.subs).filter((s) => s.id !== id));
  },
};
