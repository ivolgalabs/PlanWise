/** Утилиты дат. Не зависят от Tauri — чистый TS. */

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
export const atMidnight = (d: Date): Date =>
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
export const sortTasksByMode = <T extends { timeMinutes?: number | null; difficulty?: number; sortOrder: number }>(
  tasks: T[],
  mode: "time" | "manual" | "priority",
): T[] => {
  const arr = [...tasks];
  if (mode === "manual") {
    return arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const key = (t: T) => {
    const time = t.timeMinutes ?? Number.MAX_SAFE_INTEGER;
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
export const dueEpochLabel = (dueEpochDay: number): string => {
  const today = toEpochDay(new Date());
  const d = fromEpochDay(dueEpochDay);
  const dateStr = d.toLocaleDateString("ru", { day: "numeric", month: "short" });
  if (dueEpochDay < today) return `просрочено · ${dateStr}`;
  if (dueEpochDay <= today + 7) return "в течение недели";
  if (dueEpochDay <= today + 30) return "в течение месяца";
  return `до ${dateStr}`;
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
): T[] =>
  sortTasksByMode(
    tasks.filter((t) =>
      t.someday
        ? t.dueEpochDay === toEpochDay(d)
        : isSameDay(fromEpochDay(t.date), d),
    ),
    mode,
  );

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

/** Время задачи для бейджа: «09:00» или «09:00–10:30» (+N дн. при переходе
 *  через полночь); null — время не задано. */
export const taskTimeRange = (t: {
  timeMinutes?: number | null;
  durationMinutes?: number | null;
}): string | null => {
  if (t.timeMinutes == null) return null;
  if (!t.durationMinutes) return formatMinutes(t.timeMinutes);
  const total = t.timeMinutes + t.durationMinutes;
  const days = Math.floor(total / (24 * 60));
  return `${formatMinutes(t.timeMinutes)}–${formatMinutes(total % (24 * 60))}${days > 0 ? ` (+${days} дн.)` : ""}`;
};

/** «выезд в HH:MM» — за travelTime до начала задачи; null если не задано. */
export const travelTimeText = (t: {
  timeMinutes?: number | null;
  travelTime?: number | null;
}): string | null => {
  if (t.timeMinutes == null || !t.travelTime) return null;
  const dep = (t.timeMinutes - t.travelTime + 24 * 60) % (24 * 60);
  return `выезд в ${formatMinutes(dep)}`;
};
