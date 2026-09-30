import type { Task } from "../api";
import { api } from "../api";
import { COLORS, setHex } from "../theme";
import { isToday, isPast, isSameMonth, fromEpochDay } from "../date";
import { useStore } from "../store";
import { useSubtasks } from "../useSubtasks";
import { useI18n } from "../i18n";

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
  const { t, lang } = useI18n();
  const colorSets = useStore((s) => s.colorSets);
  const q = query.trim().toLowerCase();

  /** Имя цвет-сета для сортировки; без категории — в конец ("\uffff" префикс). */
  const colorName = (id: string | null): string => {
    if (!id) return "\uffff" + t("common.noCategory");
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
      // «Когда-нибудь»: без мягкого срока входит только в «Все»; со сроком — проверяется по dueEpochDay.
      if (t.someday) {
        if (period === "all") return true;
        if (t.dueEpochDay == null) return false;
        const dueD = fromEpochDay(t.dueEpochDay);
        if (period === "today") return isToday(dueD);
        if (period === "overdue") return isPast(dueD);
        if (period === "7days") {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const end = new Date(today); end.setDate(end.getDate() + 6);
          return dueD >= today && dueD <= end;
        }
        if (period === "month") {
          return isSameMonth(dueD, new Date());
        }
        if (period === "custom") {
          if (from != null && t.dueEpochDay < from) return false;
          if (to != null && t.dueEpochDay > to) return false;
          return true;
        }
        return false;
      }
      if (period === "today") return isToday(d);
      if (period === "overdue") return isPast(d);
      if (period === "7days") {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const end = new Date(today); end.setDate(end.getDate() + 6);
        return d >= today && d <= end;
      }
      if (period === "month") {
        return isSameMonth(d, new Date());
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
        case "alpha": return a.title.localeCompare(b.title, lang, { sensitivity: "base" });
        case "alphaDesc": return b.title.localeCompare(a.title, lang, { sensitivity: "base" });
        case "category": {
          const an = colorName(a.colorSetId), bn = colorName(b.colorSetId);
          return an.localeCompare(bn, lang) || ad - bd || a.sortOrder - b.sortOrder;
        }
        default: return ad - bd || a.sortOrder - b.sortOrder;
      }
    });

  // Активен ли хоть один фильтр (нужно для кнопки сброса).
  const anyFilter =
    q !== "" || color !== null || period !== "all" || status !== "all" || sort !== "dateAsc";

  const toggleDone = async (task: Task) => {
    await api.upsertTask({ ...task, isDone: !task.isDone });
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
            {t("search.nothing")}{" "}
            <button className="text-chip" onClick={onResetFilters} style={{ border: `1px solid var(--border-color)` }}>{t("search.reset")}</button>
          </>
        ) : (
          <>
            {t("search.found", { n: filtered.length })}
            {anyFilter && (
              <button className="text-chip" onClick={onResetFilters} style={{ border: `1px solid var(--border-color)` }}>{t("search.reset")}</button>
            )}
          </>
        )}
      </div>
      {filtered.map((task) => {
        const d = fromEpochDay(task.date);
        // «Когда-нибудь» (date=0 → 1970) просроченной не бывает: «прошлое»
        // берём у мягкого срока, а без него задача всегда актуальна.
        const past = task.someday ? (task.dueEpochDay != null && isPast(fromEpochDay(task.dueEpochDay))) : isPast(d);
        return (
          <div
            key={task.id}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "var(--sp-1) 0",
              borderBottom: `1px solid var(--border-color)`,
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
                  background: setHex(colorSets, task.colorSetId) ?? "transparent",
                }}
              />
              <label className="checkbox-hit">
                <input
                  type="checkbox"
                  checked={task.isDone}
                  onChange={() => toggleDone(task)}
                  style={{ flexShrink: 0 }}
                  title={task.isDone ? t("task.markUndone") : t("task.markDone")}
                />
              </label>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: task.isDone || past ? COLORS.muted : COLORS.text,
                  textDecoration: task.isDone ? "line-through" : "none",
                  fontSize: "var(--fs-sm)",
                }}
              >
                {task.title || t("common.noTitle")}
              </span>
              {task.someday ? (
                // «Когда-нибудь» — нет даты и перехода к дню.
                <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                  {t("common.someday")}
                </span>
              ) : (
                <button
                  className="text-chip"
                  onClick={() => onJumpToDay(d)}
                  title={t("search.jumpToDay")}
                  style={{ fontSize: "var(--fs-2xs)", flexShrink: 0 }}
                >
                  {d.toLocaleDateString(lang, {
                    day: "numeric",
                    month: "short",
                    weekday: "short",
                  })}
                  {isToday(d) ? t("search.isToday") : ""} →
                </button>
              )}
            </div>
            {/* Подзадачи задачи — компактной строкой под заголовком
                (в поиске их раньше не было вовсе). */}
            <SearchSubs taskId={task.id} done={task.isDone} />
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
  const { items: subs } = useSubtasks(taskId);
  if (subs.length === 0) return null;
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
