import type { Task } from "../api";
import { fromEpochDay } from "../api";
import { startOfWeek, firstOfMonth, isSameDay, isToday } from "../date";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  onSelectDay: (d: Date) => void;
}

/** Вид «Месяц»: сетка 6×7 с превью первых задач в ячейках. */
export function MonthView({ tasks, onSelectDay }: Props) {
  const { selectedDate, mondayFirst } = useStore();
  const first = firstOfMonth(selectedDate);
  const gridStart = startOfWeek(first, mondayFirst);

  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const tasksForDay = (d: Date) =>
    tasks.filter((t) => isSameDay(fromEpochDay(t.date), d));

  const weekdays = mondayFirst
    ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    : ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 8,
      }}
    >
      <div style={{ display: "flex" }}>
        {weekdays.map((w) => (
          <div
            key={w}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 10,
              color: COLORS.muted,
              fontWeight: 600,
              padding: "4px 0",
            }}
          >
            {w}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 3,
          flex: 1,
          minHeight: 0,
        }}
      >
        {cells.map((day) => {
          const inMonth = day.getMonth() === selectedDate.getMonth();
          const today = isToday(day);
          const dayTasks = tasksForDay(day);
          return (
            <div
              key={day.toISOString()}
              onClick={() => onSelectDay(day)}
              style={{
                background: COLORS.card,
                border: `${today ? 2 : 1}px solid ${today ? COLORS.accent : COLORS.cardBorder}`,
                borderRadius: 6,
                padding: 4,
                cursor: "pointer",
                opacity: inMonth ? 1 : 0.4,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: COLORS.text,
                  marginBottom: 2,
                }}
              >
                {day.getDate()}
              </div>
              {dayTasks.slice(0, 2).map((t) => (
                <div
                  key={t.id}
                  style={{
                    fontSize: 8,
                    color: t.isDone ? COLORS.muted : COLORS.text,
                    textDecoration: t.isDone ? "line-through" : "none",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {t.title}
                </div>
              ))}
              {dayTasks.length > 2 && (
                <div style={{ fontSize: 7, color: COLORS.muted }}>
                  +{dayTasks.length - 2}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
