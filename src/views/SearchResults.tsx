import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS, setHex } from "../theme";
import { isToday, isPast } from "../date";
import { useStore } from "../store";

/** Фильтр по периоду: все / сегодня / просроченные / ближайшие 7 дней / календарный месяц. */
export type PeriodFilter = "all" | "today" | "overdue" | "7days" | "month";
/** Фильтр по статусу выполнения. */
export type StatusFilter = "all" | "active" | "done";
/** Ключ сортировки результатов поиска. */
export type SortKey = "dateAsc" | "dateDesc" | "alpha" | "alphaDesc" | "time" | "timeDesc" | "category";

interface Props {
  tasks: Task[];
  query: string;
  /** Фильтр по цвету-сету (null = все). */
  color: string | null;
  period: PeriodFilter;
  status: StatusFilter;
  sort: SortKey;
  onJumpToDay: (d: Date) => void;
  onChange: () => void;
  onResetFilters: () => void;
}

/**
 * Результаты поиска по всем задачам: текст + цвет-сет + период + статус,
 * сортировка по ключу. Заменяет основной вид, пока активен фильтр.
 * Чекбокс отмечает задачу, кнопка с датой переходит к дню задачи.
 */
export function SearchResults({ tasks, query, color, period, status, sort, onJumpToDay, onChange, onResetFilters }: Props) {
  const { colorSets } = useStore();
  const q = query.trim().toLowerCase();

  /** Имя цвет-сета для сортировки; без категории — в конец ("\uffff" префикс). */
  const colorName = (id: string | null): string => {
    if (!id) return "\uffffБез категории";
    return colorSets.find((s) => s.id === id)?.name ?? "\uffff?";
  };

  const filtered = tasks
    .filter((t) => (q ? t.title.toLowerCase().includes(q) : true))
    .filter((t) => (color ? t.colorSetId === color : true))
    .filter((t) => {
      if (status === "active") return !t.isDone;
      if (status === "done") return t.isDone;
      return true;
    })
    .filter((t) => {
      const d = fromEpochDay(t.date);
      if (period === "today") return isToday(d);
      if (period === "overdue") return isPast(d);
      if (period === "7days") {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const end = new Date(today); end.setDate(end.getDate() + 6);
        return d >= today && d <= end;
      }
      if (period === "month") {
        const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
      }
      return true;
    })
    .sort((a, b) => {
      const ad = a.date, bd = b.date;
      const at = a.timeMinutes ?? 9999, bt = b.timeMinutes ?? 9999;
      switch (sort) {
        case "dateDesc": return bd - ad || at - bt;
        case "alpha": return a.title.localeCompare(b.title, "ru", { sensitivity: "base" });
        case "alphaDesc": return b.title.localeCompare(a.title, "ru", { sensitivity: "base" });
        case "time": return at - bt || ad - bd;
        case "timeDesc": {
          // От поздних к ранним; задачи без времени (-1) — в конце, при равенстве — по дате убыв.
          const at2 = a.timeMinutes ?? -1, bt2 = b.timeMinutes ?? -1;
          return bt2 - at2 || bd - ad;
        }
        case "category": {
          const an = colorName(a.colorSetId), bn = colorName(b.colorSetId);
          return an.localeCompare(bn, "ru") || ad - bd;
        }
        default: return ad - bd || at - bt;
      }
    });

  // Активен ли хоть один фильтр (нужно для кнопки сброса).
  const anyFilter =
    q !== "" || color !== null || period !== "all" || status !== "all" || sort !== "dateAsc";

  const toggleDone = async (t: Task) => {
    await api.upsertTask({ ...t, isDone: !t.isDone });
    onChange();
  };

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "var(--sp-6) var(--sp-8)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          flexWrap: "wrap",
          fontSize: "var(--fs-sm)",
          color: COLORS.muted,
          marginBottom: "var(--sp-2)",
        }}
      >
        {filtered.length === 0 ? (
          <>
            Ничего не найдено.{" "}
            <button className="text-chip" onClick={onResetFilters} style={{ border: `1px solid ${COLORS.cardBorder}` }}>Сбросить фильтры</button>
          </>
        ) : (
          <>
            Найдено задач: {filtered.length}
            {anyFilter && (
              <button className="text-chip" onClick={onResetFilters} style={{ border: `1px solid ${COLORS.cardBorder}` }}>Сбросить фильтры</button>
            )}
          </>
        )}
      </div>
      {filtered.map((t) => {
        const d = fromEpochDay(t.date);
        const past = isPast(d);
        return (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              padding: "var(--sp-1) 0",
              borderBottom: `1px solid ${COLORS.cardBorder}`,
            }}
          >
            <div
              style={{
                width: 3,
                height: 20,
                borderRadius: 2,
                flexShrink: 0,
                background: setHex(colorSets, t.colorSetId) ?? "transparent",
              }}
            />
            <input
              type="checkbox"
              checked={t.isDone}
              onChange={() => toggleDone(t)}
              style={{ flexShrink: 0 }}
              title={t.isDone ? "Отметить невыполненной" : "Отметить выполненной"}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: t.isDone || past ? COLORS.muted : COLORS.text,
                textDecoration: t.isDone ? "line-through" : "none",
                fontSize: "var(--fs-sm)",
              }}
            >
              {t.title || "(без названия)"}
            </span>
            <button
              className="icon-btn"
              onClick={() => onJumpToDay(d)}
              title="Перейти к этому дню"
              style={{ fontSize: "var(--fs-2xs)", flexShrink: 0 }}
            >
              {d.toLocaleDateString("ru", {
                day: "numeric",
                month: "short",
                weekday: "short",
              })}
              {isToday(d) ? " · сегодня" : ""} →
            </button>
          </div>
        );
      })}
    </div>
  );
}
