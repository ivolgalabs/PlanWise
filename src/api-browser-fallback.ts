/**
 * Браузерный фоллбек API: используется, когда приложение открыто вне Tauri
 * (vite dev в обычном браузере). Реализует те же команды, что Rust, поверх
 * localStorage — чтобы UI можно было тестировать без сборки Rust.
 * Сортировки совпадают с commands.rs (sortOrder ASC).
 */
import type { Task, ColorSet, Subtask, Day } from "./api";
import { fromEpochDay, toEpochDay } from "./date";
import { showToast } from "./toast";
import { t } from "./i18n";

const K = { tasks: "fb:tasks", sets: "fb:sets", subs: "fb:subtasks", days: "fb:days" };

/** doneAt/droppedAt — как триггеры V15: ставятся при закрытии, чистятся при снятии. */
const withDone = (prev: Task | undefined, next: Task): Task => {
  if (!next.isDone) return { ...next, doneAt: null, droppedAt: null };
  if (prev?.isDone) return { ...next, doneAt: prev.doneAt ?? next.updatedAt, droppedAt: prev.droppedAt ?? null };
  return { ...next, doneAt: Date.now(), droppedAt: next.droppedAt ?? null };
};

/** epoch-day «сегодня» по локальной дате (как toEpochDay на фронте). */
const todayEpochDay = (): number => toEpochDay(new Date());

/** Первая дата серии строго после today (ср. next_repeat_date в commands.rs):
 *  месяц считается от исходной даты, 31-е прижимается к концу месяца. */
const nextRepeatDay = (date: number, repeat: string, today: number): number => {
  const base = fromEpochDay(date);
  for (let k = 1; k <= 1200; k++) {
    let e: number;
    if (repeat === "monthly") {
      const last = new Date(base.getFullYear(), base.getMonth() + k + 1, 0).getDate();
      e = toEpochDay(new Date(base.getFullYear(), base.getMonth() + k, Math.min(base.getDate(), last)));
    } else {
      e = date + k * (repeat === "weekly" ? 7 : 1);
    }
    if (e > today) return e;
  }
  return date + 1;
};

// Дефолтные категории — как сид V1 в SQLite (ARGB-int = 0xFFRRGGBB).
// Пишутся при первом обращении, если ключа ещё нет в localStorage.
const DEFAULT_SETS: ColorSet[] = [
  { id: "cs-none", name: t("common.noCategory"), color: 4293979362, sortOrder: 0 },
  { id: "cs-work", name: t("cat.work"), color: 4291405948, sortOrder: 1 },
  { id: "cs-personal", name: t("cat.personal"), color: 4286494916, sortOrder: 2 },
  { id: "cs-sport", name: t("cat.sport"), color: 4293437564, sortOrder: 3 },
];

const load = <T,>(k: string): T[] => {
  const raw = localStorage.getItem(k);
  if (raw == null) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch (e) {
    // Битый JSON — это НЕ «пустая база»: раньше молчаливый [] выглядел как
    // потеря всех задач и первая же запись затирала исходные данные. Копию
    // сохраняем отдельным ключом, пользователю говорим.
    localStorage.setItem(`${k}:broken`, raw);
    console.error(`Повреждённые локальные данные (${k}), копия в ${k}:broken`, e);
    showToast(t("err.localDataCorrupt"));
    return [];
  }
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
    const prev = load<Task>(K.tasks).find((t) => t.id === id);
    const rec: Task = withDone(prev, { ...task, id, notes: task.notes ?? "", someday: task.someday ?? false, archived: task.archived ?? false, postponeCount: prev?.postponeCount ?? 0, updatedAt: Date.now() });
    const all = load<Task>(K.tasks).filter((t) => t.id !== id);
    all.push(rec);
    save(K.tasks, all);
    if (prev && !prev.isDone && rec.isDone && rec.repeat && !rec.someday && !rec.archived) {
      const next = nextRepeatDay(rec.date, rec.repeat, todayEpochDay());
      const dup = all.some((t) => t.title === rec.title && t.repeat === rec.repeat && t.date === next && !t.isDone);
      if (!dup) await this.duplicateTask(id, next);
    }
    return rec;
  },
  async deleteTask(id: string): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).filter((t) => t.id !== id));
    save(K.subs, load<Subtask>(K.subs).filter((s) => s.taskId !== id));
  },
  /** Дублировать задачу: копия с полями и подзадачами (как duplicate_task
   *  в Rust — наложения в браузерном фоллбеке и так не проверяются). */
  async duplicateTask(id: string, date?: number): Promise<Task> {
    const orig = load<Task>(K.tasks).find((t) => t.id === id);
    if (!orig) throw new Error(t("err.taskNotFound"));
    const copy: Task = {
      ...orig,
      id: crypto.randomUUID(),
      date: date ?? orig.date,
      isDone: false,
      archived: false,
      doneAt: null,
      droppedAt: null,
      postponeCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sortOrder: Date.now(),
    };
    const all = load<Task>(K.tasks);
    all.push(copy);
    save(K.tasks, all);
    const subs = load<Subtask>(K.subs);
    const copies = subs
      .filter((s) => s.taskId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ ...s, id: crypto.randomUUID(), taskId: copy.id, isDone: false, createdAt: Date.now() }));
    save(K.subs, [...subs, ...copies]);
    return copy;
  },
  async moveTask(id: string, newDay: number): Promise<void> {
    // Перенос в прошлое статус не меняет; закрытая в будущее = снова актуальна.
    const today = todayEpochDay();
    save(K.tasks, load<Task>(K.tasks).map((t) => {
      if (t.id !== id) return t;
      // План-задача («Когда-нибудь» со сроком): перенос меняет мягкий срок,
      // задача остаётся план-задачей (ср. move_task в commands.rs).
      if (t.someday) {
        return { ...t, dueEpochDay: newDay, date: 0, archived: false, notes: t.notes ?? "", updatedAt: Date.now() };
      }
      // Перенос открытой задачи с сегодня/прошлого на будущее (ср. move_task_to_date).
      const postponed = !t.isDone && t.date <= today && newDay > today ? 1 : 0;
      return withDone(t, { ...t, date: newDay, someday: false, archived: false, isDone: newDay > today ? false : t.isDone, postponeCount: (t.postponeCount ?? 0) + postponed, notes: t.notes ?? "", updatedAt: Date.now() });
    }));
  },
  async dropTask(id: string): Promise<void> {
    const now = Date.now();
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, isDone: true, droppedAt: now, doneAt: now, updatedAt: now } : t)));
  },
  async getDays(startDay: number, endDay: number): Promise<Day[]> {
    return load<Day>(K.days).filter((d) => d.epochDay >= startDay && d.epochDay <= endDay).sort((a, b) => a.epochDay - b.epochDay);
  },
  async upsertDay(day: Day): Promise<Day> {
    const rec: Day = { ...day, updatedAt: Date.now() };
    save(K.days, [...load<Day>(K.days).filter((d) => d.epochDay !== day.epochDay), rec]);
    return rec;
  },
  async getSomedayTasks(): Promise<Task[]> {
    return sortTasks(load<Task>(K.tasks).filter((t) => t.someday && !t.archived));
  },
  async setSomeday(id: string): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, someday: true, date: 0, dueEpochDay: null, archived: false, notes: t.notes ?? "", updatedAt: Date.now() } : t)));
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
      if (t.date < threshold && !t.isDone && !t.someday && !t.archived) { n++; return { ...t, archived: true, updatedAt: Date.now() }; }
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
    // Как moveTask: в прошлое статус не меняется; в будущее = актуальна.
    const today = todayEpochDay();
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, archived: false, date, someday: false, isDone: date > today ? false : t.isDone, notes: t.notes ?? "", updatedAt: Date.now() } : t)));
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
