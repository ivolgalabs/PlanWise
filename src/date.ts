/** Утилиты дат. Не зависят от Tauri — чистый TS. */

import { getLang, t } from "./i18n";

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

/** Полночь данной даты (локальная). */
const atMidnight = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Начало недели, содержащей d. mondayFirst=true -> ISO-неделя. */
export const startOfWeek = (d: Date, mondayFirst = true): Date => {
  const mid = atMidnight(d);
  // getDay(): 0=Sun..6=Sat
  const offset = mondayFirst ? (mid.getDay() + 6) % 7 : mid.getDay() % 7;
  mid.setDate(mid.getDate() - offset);
  return mid;
};

/** 7 дней недели. */
export const weekDays = (d: Date, mondayFirst = true): Date[] => {
  const start = startOfWeek(d, mondayFirst);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
};

/** Сравнение дат без времени. */
export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Один и тот же месяц (год + месяц). */
export const isSameMonth = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

export const isToday = (d: Date): boolean => isSameDay(d, new Date());

/** Первый день месяца. */
export const firstOfMonth = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), 1);

/** День в прошлом (строго раньше сегодня). */
export const isPast = (d: Date): boolean =>
  atMidnight(d).getTime() < atMidnight(new Date()).getTime();

/**
 * Визуальный «вес» дня для иерархии отображения:
 *  - "today"    — сегодня (крупный, акцент)
 *  - "tomorrow" — завтра (крупный, яркий)
 *  - "near"     — ближайшие 2-3 дня (нормальный)
 *  - "future"   — далёкое будущее (уменьшенный)
 *  - "past"     — прошлое (бледный, компактный)
 */
export type DayWeight = "today" | "tomorrow" | "near" | "future" | "past";

export const dayWeight = (d: Date): DayWeight => {
  const diffDays = Math.round(
    (atMidnight(d).getTime() - atMidnight(new Date()).getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 0) return "past";
  if (diffDays <= 3) return "near";
  return "future";
};

/** Форматировать минуты (0-1439) в "ЧЧ:ММ". */
export const formatMinutes = (m: number | null | undefined): string | null => {
  if (m == null) return null;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};

/** Распарсить "ЧЧ:ММ" в минуты (0-1439). null если невалидно. */
export const parseTimeToMinutes = (s: string): number | null => {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/** Сортировка задач внутри дня (по выбранному режиму из настроек):
 *  - "time"     — по времени начала (задачи без времени — вниз);
 *  - "priority" — по приоритету: высокий сверху, внутри — по времени,
 *                 без приоритета — в самый низ;
 *  - "manual"   — ручной порядок (sortOrder, перетаскиванием).
 *  Стабильная: при равенстве ключей сохраняется ручной порядок. */
const sortTasksByMode = <T extends { timeMinutes?: number | null; difficulty?: number; sortOrder: number }>(
  tasks: T[],
  mode: "time" | "manual" | "priority",
): T[] => {
  const arr = [...tasks];
  if (mode === "manual") {
    return arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const key = (t: T) => {
    // Без времени — после последней минуты дня (1440), но внутри своего
    // приоритета: с MAX_SAFE_INTEGER слагаемое времени перевешивало приоритет,
    // и сложная задача без времени уходила ниже лёгкой со временем.
    const time = t.timeMinutes ?? 1440;
    const d = t.difficulty ?? 0;
    // Приоритет: 3 (высокий) → 1, 2 → 2, 1 → 3, 0 (не задан) → 4 (вниз).
    const pr = d === 0 ? 4 : 4 - d;
    return mode === "priority" ? pr * 1_000_000 + time : time;
  };
  return arr.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka - kb || a.sortOrder - b.sortOrder;
  });
};

/** «Когда-нибудь»: сортировка по мягкому сроку — задачи со сроком вверх
 *  (сначала просроченные/близкие, потом дальние), без срока — вниз, внутри
 *  сохраняется порядок обычного режима (sortTasksByMode — стабильная). */
export const sortSomedayTasks = <
  T extends { dueEpochDay?: number | null; timeMinutes?: number | null; difficulty?: number; sortOrder: number },
>(tasks: T[], mode: "time" | "manual" | "priority"): T[] => {
  const byMode = sortTasksByMode(tasks, mode);
  return [...byMode].sort((a, b) => {
    const ad = a.dueEpochDay ?? null;
    const bd = b.dueEpochDay ?? null;
    if (ad != null && bd != null) return ad - bd;
    if (ad != null) return -1;
    if (bd != null) return 1;
    return 0;
  });
};

/** Подпись мягкого срока «Когда-нибудь»: просрочено / в течение недели /
 *  в течение месяца / до конкретной даты. */
export const dueEpochLabel = (dueEpochDay: number, lang: string = getLang()): string => {
  const today = toEpochDay(new Date());
  const d = fromEpochDay(dueEpochDay);
  const dateStr = d.toLocaleDateString(lang, { day: "numeric", month: "short" });
  if (dueEpochDay < today) return t("date.overdue", { date: dateStr });
  if (dueEpochDay <= today + 7) return t("date.withinWeek");
  if (dueEpochDay <= today + 30) return t("date.withinMonth");
  return t("date.until", { date: dateStr });
};

/** Задачи конкретного дня: «Когда-нибудь» не дублируется в днях, сортировка —
 *  по выбранному режиму. Единая точка для всех видов (день/неделя/месяц).
 *  План-задачи («В течение недели/месяца») показываются на день СВОЕГО мягкого
 *  срока (dueEpochDay): так «на неделю» попадает в неделю, «на месяц» — в месяц. */
export const tasksForDay = <
  T extends {
    someday: boolean;
    date: number;
    sortOrder: number;
    timeMinutes?: number | null;
    difficulty?: number;
    dueEpochDay?: number | null;
  },
>(
  tasks: T[],
  d: Date,
  mode: "time" | "manual" | "priority",
): T[] => {
  const ed = toEpochDay(d);
  return sortTasksByMode(
    tasks.filter((t) =>
      t.someday ? t.dueEpochDay === ed : t.date === ed,
    ),
    mode,
  );
};

/** Пересечение двух временных интервалов [start, start+duration); без
 *  длительности занимает одну минуту (две задачи «в одно время» конфликтуют,
 *  «встык» — нет). */
export const intervalsOverlap = (m1: number, d1: number, m2: number, d2: number): boolean =>
  m1 < m2 + Math.max(d2, 1) && m2 < m1 + Math.max(d1, 1);

/** Есть ли у задачи пересечение по времени с другой задачей (для списков дня). */
export const hasTimeConflict = (
  t: {
    id: string;
    timeMinutes?: number | null;
    durationMinutes?: number | null;
    isDone?: boolean;
  },
  others: Array<{
    id: string;
    timeMinutes?: number | null;
    durationMinutes?: number | null;
    isDone?: boolean;
  }>,
): boolean => {
  if (t.timeMinutes == null || t.isDone) return false;
  const d1 = t.durationMinutes ?? 0;
  return others.some(
    (o) =>
      o.id !== t.id &&
      !o.isDone &&
      o.timeMinutes != null &&
      intervalsOverlap(t.timeMinutes!, d1, o.timeMinutes, o.durationMinutes ?? 0),
  );
};

/** Карта конфликтов: id задачи → id первой пересекающейся с ней. Строится
 *  один раз на конкретный массив задач (WeakMap) — иначе каждая карточка
 *  сканировала весь массив задач при каждом изменении стора
 *  (O(карточек × задач) на любое изменение). */
const conflictCache = new WeakMap<
  Array<{
    id: string;
    date: number;
    timeMinutes?: number | null;
    durationMinutes?: number | null;
    isDone?: boolean;
    archived?: boolean;
    someday?: boolean;
  }>,
  Map<string, string>
>();

export function conflictIdFor(
  tasks: Array<{
    id: string;
    date: number;
    timeMinutes?: number | null;
    durationMinutes?: number | null;
    isDone?: boolean;
    archived?: boolean;
    someday?: boolean;
  }>,
  task: { id: string; timeMinutes?: number | null; isDone?: boolean },
): string | null {
  if (task.timeMinutes == null || task.isDone) return null;
  let map = conflictCache.get(tasks);
  if (!map) {
    map = new Map();
    const active = tasks.filter(
      (t) => !t.isDone && !t.archived && !t.someday && t.timeMinutes != null,
    );
    for (let i = 0; i < active.length; i++) {
      const a = active[i]!;
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j]!;
        if (a.date !== b.date) continue;
        if (
          !intervalsOverlap(
            a.timeMinutes!,
            a.durationMinutes ?? 0,
            b.timeMinutes!,
            b.durationMinutes ?? 0,
          )
        ) {
          continue;
        }
        if (!map.has(a.id)) map.set(a.id, b.id);
        if (!map.has(b.id)) map.set(b.id, a.id);
      }
    }
    conflictCache.set(tasks, map);
  }
  return map.get(task.id) ?? null;
}

/** Время задачи для бейджа: «09:00» или «09:00–10:30» (+N дн. при переходе
 *  через полночь); null — время не задано. */
export const taskTimeRange = (task: {
  timeMinutes?: number | null;
  durationMinutes?: number | null;
}): string | null => {
  if (task.timeMinutes == null) return null;
  if (!task.durationMinutes) return formatMinutes(task.timeMinutes);
  const total = task.timeMinutes + task.durationMinutes;
  const days = Math.floor(total / (24 * 60));
  return `${formatMinutes(task.timeMinutes)}–${formatMinutes(total % (24 * 60))}${days > 0 ? t("date.plusDays", { n: days }) : ""}`;
};

/** «выезд в HH:MM» — за travelTime до начала задачи; null если не задано. */
export const travelTimeText = (task: {
  timeMinutes?: number | null;
  travelTime?: number | null;
}): string | null => {
  if (task.timeMinutes == null || !task.travelTime) return null;
  const diff = task.timeMinutes - task.travelTime;
  const dep = ((diff % 1440) + 1440) % 1440;
  const note = diff < 0 ? t("date.eve") : "";
  return `${t("date.departure", { time: formatMinutes(dep) ?? "" })}${note}`;
};
