import { invoke } from "@tauri-apps/api/core";
import { toEpochDay } from "./date";
import { browserApi } from "./api-browser-fallback";
import type { TaskPattern } from "./store";

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
  archived: boolean; // «Архив»: скрыта из видов, ждёт возврата
  /** Минуты на дорогу — уведомление «Пора выезжать» за это время до начала. */
  travelTime?: number | null;
  /** Длительность выполнения в минутах (показ «09:00–10:30»). */
  durationMinutes?: number | null;
  /** Сложность («класс» задачи): 0=не задана, 1=лёгкая, 2=средняя, 3=сложная. */
  difficulty?: number;
  /** Своё уведомление задачи: null=по умолчанию (из настроек), 0=не уведомлять,
   *  N=напомнить за N минут до начала. */
  notifyMinutes?: number | null;
  /** Напомнить за N минут до выезда (выезд = время начала − travelTime);
   *  null = отдельно не напоминать. Актуально при заданном travelTime. */
  travelNotifyMinutes?: number | null;
  /** «Когда-нибудь»: мягкий срок (epoch-day); null = без срока. */
  dueEpochDay?: number | null;
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

/** Вложение заметки: файл, прикреплённый к задаче (хранится в приватном
 *  каталоге приложения; в БД — метаданные). */
export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  mime: string;
  size: number;
  createdAt: number;
}

/** Доступен ли Tauri-рантайм (иначе используем браузерный фоллбек). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

/**
 * Android-рантайм. Только там системные диалоги возвращают content://, который
 * умеет читать/писать tauri-plugin-fs (и только там ему выданы права fs:*):
 * на десктопе ручной экспорт/импорт делает Rust (export_backup/import_backup),
 * у вебвью прав на произвольную запись файлов нет.
 */
export const isAndroid = (): boolean =>
  typeof navigator !== "undefined" && navigator.userAgent.includes("Android");

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
      archived: task.archived ?? false,
      travelTime: task.travelTime ?? null,
      durationMinutes: task.durationMinutes ?? null,
      difficulty: task.difficulty ?? 0,
      notifyMinutes: task.notifyMinutes ?? null,
      travelNotifyMinutes: task.travelNotifyMinutes ?? null,
      dueEpochDay: task.dueEpochDay ?? null,
    };
    return isTauri() ? invoke<Task>("upsert_task", { task: t }) : browserApi.upsertTask(t);
  },
  deleteTask: (id: string) => (isTauri() ? invoke<void>("delete_task", { id }) : browserApi.deleteTask(id)),
  /** Дублировать задачу: полная копия (время, длительность, напоминание,
   *  выезд, приоритет, категория, заметка, подзадачи) с новым id; выполненность
   *  и архив сняты. Копия сознательно встаёт в тот же слот времени (без
   *  проверки наложений). Вложения (файлы) не копируются. */
  duplicateTask: (id: string) =>
    isTauri() ? invoke<Task>("duplicate_task", { id }) : browserApi.duplicateTask(id),
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
  /** Архив: просроченные невыполненные задачи. Возвращает кол-во.
   *  Граница «сегодня» вычисляется на бэкенде (часы устройства). */
  archiveOverdue: () =>
    isTauri() ? invoke<number>("archive_overdue") : browserApi.archiveOverdue(),
  /** Задачи «Архива» (скрыты из видов, ждут возврата). */
  getArchivedTasks: () => (isTauri() ? invoke<Task[]>("get_archived_tasks") : browserApi.getArchivedTasks()),
  /** Вернуть задачу из архива на выбранную дату. */
  restoreArchived: (id: string, date: Date) => {
    const d = toEpochDay(date);
    return isTauri() ? invoke<void>("restore_archived", { id, date: d }) : browserApi.restoreArchived(id, d);
  },
  getSubtasks: (taskId: string) => (isTauri() ? invoke<Subtask[]>("get_subtasks", { taskId }) : browserApi.getSubtasks(taskId)),
  upsertSubtask: (sub: Partial<Subtask> & { taskId: string; title: string }) => {
    const s = { id: sub.id ?? "", taskId: sub.taskId, title: sub.title, isDone: sub.isDone ?? false, sortOrder: sub.sortOrder ?? Date.now(), createdAt: sub.createdAt ?? 0 };
    return isTauri() ? invoke<Subtask>("upsert_subtask", { sub: s }) : browserApi.upsertSubtask(s);
  },
  deleteSubtask: (id: string) => (isTauri() ? invoke<void>("delete_subtask", { id }) : browserApi.deleteSubtask(id)),
  /** Настройка приложения из таблицы settings (key/value в SQLite). */
  getSetting: (key: string) =>
    isTauri() ? invoke<string | null>("get_setting", { key }) : browserApi.getSetting(key),
  /** Сохранить настройку приложения в таблицу settings. */
  setSetting: (key: string, value: string) =>
    isTauri() ? invoke<void>("set_setting", { key, value }) : browserApi.setSetting(key, value),
  /** Вложения заметок: список файлов задачи. */
  listAttachments: (taskId: string) =>
    isTauri() ? invoke<Attachment[]>("list_attachments", { taskId }) : Promise.resolve([]),
  /** Добавить вложение: файл передаётся base64 (читает plugin-fs, т.к. на
   *  Android диалог возвращает content://, который Rust не читает). */
  addAttachment: (taskId: string, fileName: string, mime: string, dataB64: string) =>
    isTauri()
      ? invoke<Attachment>("add_attachment", { taskId, fileName, mime, dataB64 })
      : Promise.reject(new Error("Доступно в приложении")),
  /** Удалить вложение (строка + файл с диска). */
  deleteAttachment: (id: string) =>
    isTauri() ? invoke<void>("delete_attachment", { id }) : Promise.resolve(),
  /** Абсолютный путь файла вложения — для открытия системным приложением. */
  attachmentPath: (id: string) =>
    isTauri() ? invoke<string>("attachment_path", { id }) : Promise.reject(new Error("Доступно в приложении")),
};

/** Создать задачу из шаблона на дату: задача получает ВСЕ параметры шаблона
 *  (время, сложность, длительность, уведомление, выезд, категорию, заметку)
 *  и подзадачи. Общее для «Дня» и «Недели» (кнопки «+ Шаблон»). */
export const createTaskFromPattern = async (
  p: TaskPattern,
  date: number,
): Promise<void> => {
  const created = await api.upsertTask({
    title: p.title,
    date,
    timeMinutes: p.timeMinutes,
    difficulty: p.difficulty,
    durationMinutes: p.durationMinutes,
    notifyMinutes: p.notifyMinutes ?? null,
    travelTime: p.travelTime ?? null,
    // Раньше терялось: задача из шаблона не получала «время собираться».
    travelNotifyMinutes: p.travelNotifyMinutes ?? null,
    colorSetId: p.colorSetId ?? null,
    notes: p.notes ?? "",
  });
  for (const s of p.subtasks ?? []) {
    const st = s.trim();
    if (st) await api.upsertSubtask({ taskId: created.id, title: st });
  }
};
