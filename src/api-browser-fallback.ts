/**
 * Браузерный фоллбек API: используется, когда приложение открыто вне Tauri
 * (vite dev в обычном браузере). Реализует те же команды, что Rust, поверх
 * localStorage — чтобы UI можно было тестировать без сборки Rust.
 * Сортировки совпадают с commands.rs (sortOrder ASC).
 */
import type { Task, ColorSet, Subtask } from "./api";
import { toEpochDay } from "./date";

const K = { tasks: "fb:tasks", sets: "fb:sets", subs: "fb:subtasks" };

/** epoch-day «сегодня» по локальной дате (как toEpochDay на фронте). */
const todayEpochDay = (): number => toEpochDay(new Date());

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
  arr.sort((a, b) => a.sortOrder - b.sortOrder);

export const browserApi = {
  async getTasks(startDay: number, endDay: number): Promise<Task[]> {
    // Нормализуем notes/archived: у старых записей localStorage поля нет
    // (undefined), а Rust всегда отдаёт ""/false — приводим к единому виду,
    // чтобы TaskCard не падал.
    return sortTasks(
      load<Task>(K.tasks)
        .filter((t) => !t.someday && !t.archived && t.date >= startDay && t.date <= endDay)
        .map((t) => ({ ...t, notes: t.notes ?? "", archived: t.archived ?? false })),
    );
  },
  async upsertTask(task: Task): Promise<Task> {
    const id = task.id || crypto.randomUUID();
    // updatedAt ставим при каждом сохранении — как Rust-бэкенд (иначе
    // сортировка архива по updated_at разъезжается между режимами).
    const rec: Task = { ...task, id, notes: task.notes ?? "", someday: task.someday ?? false, archived: task.archived ?? false, updatedAt: Date.now() };
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
    // Перенос в прошлое = задача выполнена; в будущее = снова актуальна.
    const today = todayEpochDay();
    save(K.tasks, load<Task>(K.tasks).map((t) => {
      if (t.id !== id) return t;
      // План-задача («Когда-нибудь» со сроком): перенос меняет мягкий срок,
      // задача остаётся план-задачей (ср. move_task в commands.rs).
      if (t.someday) {
        return { ...t, dueEpochDay: newDay, date: 0, archived: false, notes: t.notes ?? "" };
      }
      return { ...t, date: newDay, someday: false, archived: false, isDone: newDay < today ? true : newDay > today ? false : t.isDone, notes: t.notes ?? "" };
    }));
  },
  async getSomedayTasks(): Promise<Task[]> {
    return sortTasks(load<Task>(K.tasks).filter((t) => t.someday && !t.archived));
  },
  async setSomeday(id: string): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, someday: true, date: 0, dueEpochDay: null, archived: false, notes: t.notes ?? "" } : t)));
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
  async archiveOverdue(): Promise<number> {
    // Граница архивации — задачи старше вчерашнего дня (date < today - 1), как на бэкенде.
    const threshold = toEpochDay(new Date()) - 1;
    let n = 0;
    save(K.tasks, load<Task>(K.tasks).map((t) => {
      if (t.date < threshold && !t.isDone && !t.someday && !t.archived) { n++; return { ...t, archived: true }; }
      return t;
    }));
    return n;
  },
  async getArchivedTasks(): Promise<Task[]> {
    return load<Task>(K.tasks)
      .filter((t) => t.archived)
      .map((t) => ({ ...t, notes: t.notes ?? "", archived: t.archived ?? false }))
      .sort((a, b) => b.date - a.date || b.updatedAt - a.updatedAt);
  },
  async restoreArchived(id: string, date: number): Promise<void> {
    // Возврат в прошлое = выполнена (иначе снова уйдёт в архив); в будущее = актуальна.
    const today = todayEpochDay();
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, archived: false, date, someday: false, isDone: date < today ? true : date > today ? false : t.isDone, notes: t.notes ?? "" } : t)));
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
  async getSetting(key: string): Promise<string | null> {
    return localStorage.getItem(`fb:setting:${key}`);
  },
  async setSetting(key: string, value: string): Promise<void> {
    localStorage.setItem(`fb:setting:${key}`, value);
  },
};
