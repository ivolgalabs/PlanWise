/** Разбор строки быстрого ввода: «Завтра созвон в 15:00» → день и время вынимаются
 *  из названия. Токены ищутся только по краям строки, чтобы слова внутри названия
 *  не превращались в дату. Если от названия ничего не остаётся — строка не трогается.
 *  ponytail: только сегодня/завтра/послезавтра (ru, en) и время «H:MM» / «в H»;
 *  дни недели и даты — когда понадобятся. */
export interface QuickAdd {
  title: string;
  /** Смещение от сегодня в днях; null — день не указан. */
  dayOffset: number | null;
  timeMinutes: number | null;
}

const DAYS: Record<string, number> = { сегодня: 0, завтра: 1, послезавтра: 2, today: 0, tomorrow: 1 };
const DAY = "(сегодня|завтра|послезавтра|today|tomorrow)";
const TIME = "(?:(?:в|at)\\s+(\\d{1,2})(?::(\\d{2}))?|(\\d{1,2}):(\\d{2}))";
const RES = {
  dayHead: new RegExp(`^${DAY}\\s+`, "i"),
  dayTail: new RegExp(`\\s+${DAY}$`, "i"),
  timeHead: new RegExp(`^${TIME}\\s+`, "i"),
  timeTail: new RegExp(`\\s+${TIME}$`, "i"),
};

const minutes = (m: RegExpMatchArray): number | null => {
  const h = Number(m[1] ?? m[3]);
  const min = Number(m[2] ?? m[4] ?? 0);
  return h < 24 && min < 60 ? h * 60 + min : null;
};

export function parseQuickAdd(raw: string): QuickAdd {
  let title = raw.trim();
  let dayOffset: number | null = null;
  let timeMinutes: number | null = null;
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of [RES.dayHead, RES.dayTail]) {
      const m: RegExpMatchArray | null = dayOffset == null ? title.match(re) : null;
      if (m) {
        dayOffset = DAYS[m[1].toLowerCase()];
        title = title.replace(re, "").trim();
        changed = true;
      }
    }
    for (const re of [RES.timeHead, RES.timeTail]) {
      const m: RegExpMatchArray | null = timeMinutes == null ? title.match(re) : null;
      const min: number | null = m ? minutes(m) : null;
      if (m && min != null) {
        timeMinutes = min;
        title = title.replace(re, "").trim();
        changed = true;
      }
    }
  }
  // Пусто или осталась одна «в»/«at» (от «в 15:00»): названия нет — строку не трогаем.
  return !/^(в|at)?$/i.test(title) ? { title, dayOffset, timeMinutes } : { title: raw.trim(), dayOffset: null, timeMinutes: null };
}

/** Поля задачи для upsertTask из введённой строки: день — от сегодня, если он назван,
 *  иначе день колонки, куда вводили. */
export const quickTask = (raw: string, columnDay: number, today: number) => {
  const q = parseQuickAdd(raw);
  return {
    title: q.title,
    date: q.dayOffset == null ? columnDay : today + q.dayOffset,
    timeMinutes: q.timeMinutes,
  };
};
