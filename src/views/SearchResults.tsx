import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS, setHex } from "../theme";
import { isToday, isPast } from "../date";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  query: string;
  /** Фильтр по цвету-сету (null = все). */
  color: string | null;
  onJumpToDay: (d: Date) => void;
  onChange: () => void;
}

/**
 * Результаты поиска по всем задачам (текст + цвет-сет).
 * Заменяет основной вид, пока активен фильтр. Чекбокс отмечает задачу,
 * кнопка с датой переходит к дню задачи.
 */
export function SearchResults({ tasks, query, color, onJumpToDay, onChange }: Props) {
  const { colorSets } = useStore();
  const q = query.trim().toLowerCase();
  const filtered = tasks
    .filter((t) => (q ? t.title.toLowerCase().includes(q) : true))
    .filter((t) => (color ? t.colorSetId === color : true))
    .sort(
      (a, b) =>
        a.date - b.date || (a.timeMinutes ?? 9999) - (b.timeMinutes ?? 9999),
    );

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
          fontSize: "var(--fs-2xs)",
          color: COLORS.muted,
          marginBottom: "var(--sp-2)",
        }}
      >
        {filtered.length === 0
          ? "Ничего не найдено"
          : `Найдено задач: ${filtered.length}`}
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
