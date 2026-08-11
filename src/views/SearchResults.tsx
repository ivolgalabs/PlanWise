import { useEffect, useState } from "react";
import type { Subtask, Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS, setHex } from "../theme";
import { isToday, isPast } from "../date";
import { useStore } from "../store";

/** Фильтр по периоду: все / сегодня / просроченные / ближайшие 7 дней /
 *  календарный месяц / произвольный диапазон «с/по». */
export type PeriodFilter = "all" | "today" | "overdue" | "7days" | "month" | "custom";
/** Фильтр по статусу выполнения. */
export type StatusFilter = "all" | "active" | "done";
/** Ключ сортировки результатов поиска. */
export type SortKey = "dateAsc" | "dateDesc" | "alpha" | "alphaDesc" | "category";

interface Props {
  tasks: Task[];
  query: string;
  /** Фильтр по цвету-сету (null = все). */
  color: string | null;
  period: PeriodFilter;
  status: StatusFilter;
  sort: SortKey;
  /** Границы произвольного периода «с/по» (epoch-day; null = край не задан). */
  from: number | null;
  to: number | null;
  onJumpToDay: (d: Date) => void;
  onChange: () => void;
  onResetFilters: () => void;
}

/**
 * Результаты поиска по всем задачам: текст + цвет-сет + период + статус,
 * сортировка по ключу. Заменяет основной вид, пока активен фильтр.
 * Чекбокс отмечает задачу, кнопка с датой переходит к дню задачи.
 */
export function SearchResults({ tasks, query, color, period, status, sort, from, to, onJumpToDay, onChange, onResetFilters }: Props) {
  const colorSets = useStore((s) => s.colorSets);
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
      // «Когда-нибудь» (date = 0 → 1970 год) никогда не бывает «просроченной»
      // и не входит в диапазоны дат — только в «Все».
      if (t.someday) return false;
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
      if (period === "custom") {
        // Произвольный диапазон: epoch-day задачи сравниваем напрямую;
        // незаполненный край — без ограничения.
        if (from != null && t.date < from) return false;
        if (to != null && t.date > to) return false;
        return true;
      }
      return true;
    })
    .sort((a, b) => {
      const ad = a.date, bd = b.date;
      switch (sort) {
        case "dateDesc": return bd - ad || a.sortOrder - b.sortOrder;
        case "alpha": return a.title.localeCompare(b.title, "ru", { sensitivity: "base" });
        case "alphaDesc": return b.title.localeCompare(a.title, "ru", { sensitivity: "base" });
        case "category": {
          const an = colorName(a.colorSetId), bn = colorName(b.colorSetId);
          return an.localeCompare(bn, "ru") || ad - bd || a.sortOrder - b.sortOrder;
        }
        default: return ad - bd || a.sortOrder - b.sortOrder;
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
        minHeight: 0,
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
              flexDirection: "column",
              padding: "var(--sp-1) 0",
              borderBottom: `1px solid ${COLORS.cardBorder}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
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
              <label className="checkbox-hit">
                <input
                  type="checkbox"
                  checked={t.isDone}
                  onChange={() => toggleDone(t)}
                  style={{ flexShrink: 0 }}
                  title={t.isDone ? "Отметить невыполненной" : "Отметить выполненной"}
                />
              </label>
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
              {t.someday ? (
                // «Когда-нибудь» — нет даты и перехода к дню.
                <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                  Когда-нибудь
                </span>
              ) : (
                <button
                  className="text-chip"
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
              )}
            </div>
            {/* Подзадачи задачи — компактной строкой под заголовком
                (в поиске их раньше не было вовсе). */}
            <SearchSubs taskId={t.id} done={t.isDone} />
          </div>
        );
      })}
    </div>
  );
}

/** Подзадачи одной задачи в строке поиска. Показываем первые 3 + счётчик
 *  остальных, чтобы строка не раздувалась. Ошибка загрузки — молча (блок
 *  просто не нужен в результатах поиска). */
function SearchSubs({ taskId, done }: { taskId: string; done: boolean }) {
  const [subs, setSubs] = useState<Subtask[] | null>(null);
  useEffect(() => {
    let alive = true;
    setSubs(null);
    api
      .getSubtasks(taskId)
      .then((list) => {
        if (alive) setSubs(list);
      })
      .catch(() => {
        if (alive) setSubs([]);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);
  if (!subs || subs.length === 0) return null;
  const shown = subs.slice(0, 3);
  const rest = subs.length - shown.length;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        marginLeft: "calc(var(--sp-4) + 14px)",
        fontSize: "var(--fs-2xs)",
        color: COLORS.muted,
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {shown.map((s) => (
        <span
          key={s.id}
          style={{
            textDecoration: s.isDone || done ? "line-through" : "none",
            color: s.isDone || done ? COLORS.muted : COLORS.secondary,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {s.title}
        </span>
      ))}
      {rest > 0 && <span>+{rest}</span>}
    </div>
  );
}
