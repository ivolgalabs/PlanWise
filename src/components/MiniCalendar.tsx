import type { Task } from "../api";
import { fromEpochDay } from "../api";
import { startOfWeek, firstOfMonth, isSameDay } from "../date";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  /** Крупный режим (для боковой панели DayView). */
  large?: boolean;
  /** Колбэк выбора дня (если не задан — использует store.setSelectedDate). */
  onSelect?: (d: Date) => void;
}

type BusyLevel = "free" | "light" | "heavy";

const busyLevel = (n: number): BusyLevel =>
  n === 0 ? "free" : n <= 2 ? "light" : "heavy";

/** Мини-календарь месяца с индикатором занятости дней. */
export function MiniCalendar({ tasks, large, onSelect }: Props) {
  const { selectedDate, setSelectedDate, mondayFirst } = useStore();
  const first = firstOfMonth(selectedDate);
  const gridStart = startOfWeek(first, mondayFirst);

  const countForDay = (d: Date): number =>
    tasks.filter((t) => isSameDay(fromEpochDay(t.date), d)).length;

  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const pick = (d: Date) => {
    const clean = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (onSelect) onSelect(clean);
    else setSelectedDate(clean);
  };

  // Масштаб: large — крупнее шрифт/ячейки.
  const fs = large ? "var(--fs-sm)" : 9;
  const cellPad = large ? "8px 0" : "3px 0";
  const monthFs = large ? "var(--fs-md)" : 11;

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: "var(--radius-lg)",
        padding: large ? "var(--sp-6)" : 10,
      }}
    >
      <div
        style={{
          fontSize: monthFs,
          fontWeight: 600,
          color: COLORS.text,
          marginBottom: "var(--sp-4)",
          textTransform: "capitalize",
        }}
      >
        {first.toLocaleDateString("ru", { month: "long", year: "numeric" })}
      </div>
      <div style={{ display: "flex", marginBottom: 6 }}>
        {["П", "В", "С", "Ч", "П", "С", "В"].map((w, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: large ? "var(--fs-2xs)" : 8,
              color: COLORS.muted,
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
          gap: large ? 3 : 2,
        }}
      >
        {cells.map((day, i) => {
          const inMonth = day.getMonth() === first.getMonth();
          const selected = isSameDay(day, selectedDate);
          const level = busyLevel(countForDay(day));
          return (
            <div
              key={i}
              onClick={() => pick(day)}
              style={{
                textAlign: "center",
                padding: cellPad,
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
                background: selected ? COLORS.accent + "26" : "transparent",
              }}
            >
              <div
                style={{
                  fontSize: fs,
                  fontWeight: selected ? 700 : 400,
                  color: inMonth
                    ? selected
                      ? COLORS.accent
                      : COLORS.text
                    : COLORS.muted + "66",
                }}
              >
                {day.getDate()}
              </div>
              <BusyDot level={level} large={large} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BusyDot({
  level,
  large,
}: {
  level: BusyLevel;
  large?: boolean;
}) {
  const sz = large ? 4 : 3;
  if (level === "free") return <div style={{ height: sz }} />;
  if (level === "light")
    return (
      <div
        style={{
          width: sz,
          height: sz,
          margin: "2px auto 0",
          borderRadius: "50%",
          background: COLORS.accent,
        }}
      />
    );
  return (
    <div
      style={{
        width: large ? 14 : 10,
        height: 3,
        margin: "2px auto 0",
        borderRadius: 2,
        background: COLORS.setSport,
      }}
    />
  );
}
