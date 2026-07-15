import type { Task } from "../api";
import { fromEpochDay } from "../api";
import { startOfWeek, firstOfMonth, isSameDay } from "../date";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
}

type BusyLevel = "free" | "light" | "heavy";

const busyLevel = (n: number): BusyLevel =>
  n === 0 ? "free" : n <= 2 ? "light" : "heavy";

/** Мини-календарь месяца с индикатором занятости дней. */
export function MiniCalendar({ tasks }: Props) {
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

  const monthTitle = first.toLocaleDateString("ru", {
    month: "long",
    year: "numeric",
  });

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: COLORS.text,
          marginBottom: 8,
          textTransform: "capitalize",
        }}
      >
        {monthTitle}
      </div>
      <div style={{ display: "flex", marginBottom: 4 }}>
        {["П", "В", "С", "Ч", "П", "С", "В"].map((w, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 8,
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
          gap: 2,
        }}
      >
        {cells.map((day, i) => {
          const inMonth = day.getMonth() === first.getMonth();
          const selected = isSameDay(day, selectedDate);
          const level = busyLevel(countForDay(day));
          return (
            <div
              key={i}
              onClick={() =>
                setSelectedDate(
                  new Date(day.getFullYear(), day.getMonth(), day.getDate()),
                )
              }
              style={{
                textAlign: "center",
                padding: "3px 0",
                cursor: "pointer",
                borderRadius: 4,
                background: selected ? COLORS.accent + "26" : "transparent",
              }}
            >
              <div
                style={{
                  fontSize: 9,
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
              <BusyDot level={level} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BusyDot({ level }: { level: BusyLevel }) {
  if (level === "free") return <div style={{ height: 3 }} />;
  if (level === "light")
    return (
      <div
        style={{
          width: 3,
          height: 3,
          margin: "1px auto 0",
          borderRadius: "50%",
          background: COLORS.accent,
        }}
      />
    );
  return (
    <div
      style={{
        width: 10,
        height: 3,
        margin: "1px auto 0",
        borderRadius: 2,
        background: COLORS.setSport,
      }}
    />
  );
}
