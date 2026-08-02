import { useState } from "react";
import { startOfWeek, firstOfMonth, isSameDay } from "../date";
import { COLORS, accentTint, varTint } from "../theme";
import { useStore } from "../store";

interface Props {
  initial: Date;
  onPick: (d: Date) => void;
  onClose: () => void;
}

/** Модалка выбора произвольной даты (прыжок). */
export function DatePickerModal({ initial, onPick, onClose }: Props) {
  const { mondayFirst } = useStore();
  const [cursor, setCursor] = useState(initial);
  const first = firstOfMonth(cursor);
  const gridStart = startOfWeek(first, mondayFirst);

  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const monthTitle = first.toLocaleDateString("ru", {
    month: "long",
    year: "numeric",
  });

  // Заголовки дней недели — в порядке начала недели, согласованы с сеткой
  // (startOfWeek(first, mondayFirst)), иначе колонки разъезжаются.
  const weekdays = mondayFirst
    ? ["П", "В", "С", "Ч", "П", "С", "В"]
    : ["В", "П", "В", "С", "Ч", "П", "С"];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: "var(--radius-xl)",
          padding: "var(--sp-6)",
          width: 280,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "var(--sp-4)",
          }}
        >
          <button
            className="icon-btn"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
          >
            ‹
          </button>
          <div
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: "var(--fs-sm)",
              fontWeight: 600,
              color: COLORS.text,
              textTransform: "capitalize",
            }}
          >
            {monthTitle}
          </div>
          <button
            className="icon-btn"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
          >
            ›
          </button>
        </div>
        <div style={{ display: "flex", marginBottom: 4 }}>
          {weekdays.map((w, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: "var(--fs-2xs)",
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
            const selected = isSameDay(day, initial);
            return (
              <button
                key={i}
                onClick={() => {
                  onPick(
                    new Date(day.getFullYear(), day.getMonth(), day.getDate()),
                  );
                  onClose();
                }}
                style={{
                  padding: "4px 0",
                  fontSize: "var(--fs-xs)",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: selected ? 700 : 400,
                  color: inMonth
                    ? selected
                      ? COLORS.accent
                      : COLORS.text
                    : varTint("--text-muted", 0.4),
                  background: selected ? accentTint(0.15) : "transparent",
                }}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
