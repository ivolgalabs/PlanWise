/** Утилиты дат. Не зависят от Tauri — чистый TS. */

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

export const isToday = (d: Date): boolean => isSameDay(d, new Date());

/** Первый день месяца. */
export const firstOfMonth = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), 1);

/** Последний день месяца. */
export const lastOfMonth = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth() + 1, 0);

/** День в прошлом (строго раньше сегодня). */
export const isPast = (d: Date): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day.getTime() < today.getTime();
};

/** День в будущем (строго позже сегодня). */
export const isFuture = (d: Date): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day.getTime() > today.getTime();
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
