/**
 * Браузерный фоллбек API: используется, когда приложение открыто вне Tauri
 * (vite dev в обычном браузере). Реализует те же команды, что Rust, поверх
 * localStorage — чтобы UI можно было тестировать без сборки Rust.
 * Сортировки совпадают с commands.rs (время ASC → sortOrder ASC).
 */
import type { Task, ColorSet, Subtask } from "./api";

const K = { tasks: "fb:tasks", sets: "fb:sets", subs: "fb:subtasks" };

// Дефолтные категории — как сид V1 в SQLite (ARGB-int = 0xFFRRGGBB).
// Пишутся при первом обращении, если ключа ещё нет в localStorage.
const DEFAULT_SETS: ColorSet[] = [
  { id: "cs-none", name: "Без категории", color: 4293979362, sortOrder: 0 },
  { id: "cs-work", name: "Работа", color: 4291405948, sortOrder: 1 },
  { id: "cs-personal", name: "Личное", color: 4286494916, sortOrder: 2 },
  { id: "cs-sport", name: "Спорт", color: 4293437564, sortOrder: 3 },
];

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
    // Нормализуем notes: у старых записей localStorage поля нет (undefined),
    // а Rust всегда отдаёт "" — приводим к единому виду, чтобы TaskCard не падал.
    return sortTasks(
      load<Task>(K.tasks)
        .filter((t) => !t.someday && t.date >= startDay && t.date <= endDay)
        .map((t) => ({ ...t, notes: t.notes ?? "" })),
    );
  },
  async upsertTask(task: Task): Promise<Task> {
    const id = task.id || crypto.randomUUID();
    const rec: Task = { ...task, id, notes: task.notes ?? "", someday: task.someday ?? false };
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
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, date: newDay, someday: false, notes: t.notes ?? "" } : t)));
  },
  async getSomedayTasks(): Promise<Task[]> {
    return sortTasks(load<Task>(K.tasks).filter((t) => t.someday));
  },
  async setSomeday(id: string): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, someday: true, date: 0, notes: t.notes ?? "" } : t)));
  },
  async getColorSets(): Promise<ColorSet[]> {
    // Первый запуск (или после очистки storage): создаём дефолтные категории.
    if (localStorage.getItem(K.sets) === null) {
      save(K.sets, DEFAULT_SETS);
    }
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
      if (t.date < todayDay && !t.isDone && !t.someday) { n++; return { ...t, date: todayDay }; }
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
