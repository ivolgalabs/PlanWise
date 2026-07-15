import { useState } from "react";
import { startOfWeek, firstOfMonth, isSameDay } from "../date";
import { COLORS } from "../theme";

interface Props {
  initial: Date;
  onPick: (d: Date) => void;
  onClose: () => void;
}

/** Модалка выбора произвольной даты (прыжок). */
export function DatePickerModal({ initial, onPick, onClose }: Props) {
  const [cursor, setCursor] = useState(initial);
  const first = firstOfMonth(cursor);
  const gridStart = startOfWeek(first, true);

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
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(90,82,64,.3)",
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
          borderRadius: 10,
          padding: 16,
          width: 260,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 12,
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
              fontSize: 13,
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
          {["П", "В", "С", "Ч", "П", "С", "В"].map((w, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 9,
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
                  fontSize: 11,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: selected ? 700 : 400,
                  color: inMonth
                    ? selected
                      ? COLORS.accent
                      : COLORS.text
                    : COLORS.muted + "66",
                  background: selected ? COLORS.accent + "26" : "transparent",
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
