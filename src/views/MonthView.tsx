import { useState } from "react";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { startOfWeek, firstOfMonth, isSameDay, isToday, isPast } from "../date";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  onSelectDay: (d: Date) => void;
  onChange: () => void;
}

/** Вид «Месяц»: сетка с читаемым превью задач + меню по клику на день. */
export function MonthView({ tasks, onSelectDay, onChange }: Props) {
  const { selectedDate, mondayFirst } = useStore();
  const [menuDay, setMenuDay] = useState<Date | null>(null);
  const [addTitle, setAddTitle] = useState("");
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

  const openDay = (d: Date) => {
    setMenuDay(null);
    onSelectDay(d);
  };

  const addTask = async (d: Date) => {
    const t = addTitle.trim();
    if (!t) return;
    const epochDay = Math.floor(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
    );
    await api.upsertTask({ title: t, date: epochDay });
    setAddTitle("");
    setMenuDay(null);
    onChange();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--sp-4)" }}>
      <div style={{ display: "flex" }}>
        {weekdays.map((w) => (
          <div
            key={w}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: "var(--fs-2xs)",
              color: COLORS.muted,
              fontWeight: 600,
              padding: "var(--sp-2) 0",
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
          gap: "var(--sp-2)",
          flex: 1,
          minHeight: 0,
        }}
      >
        {cells.map((day) => {
          const inMonth = day.getMonth() === selectedDate.getMonth();
          const today = isToday(day);
          const past = isPast(day);
          const dayTasks = tasksForDay(day);
          return (
            <div
              key={day.toISOString()}
              onClick={() => setMenuDay(day)}
              style={{
                background: COLORS.card,
                border: `${today ? 2 : 1}px solid ${today ? COLORS.accent : COLORS.cardBorder}`,
                borderRadius: "var(--radius-md)",
                padding: "var(--sp-2)",
                cursor: "pointer",
                opacity: !inMonth ? 0.35 : past ? 0.6 : 1,
                minHeight: 0,
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  fontSize: "var(--fs-sm)",
                  fontWeight: 600,
                  color: COLORS.text,
                  marginBottom: "var(--sp-1)",
                }}
              >
                {day.getDate()}
              </div>
              {dayTasks.slice(0, 6).map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: "var(--fs-2xs)",
                    color: t.isDone ? COLORS.muted : COLORS.text,
                    textDecoration: t.isDone ? "line-through" : "none",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.3,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background:
                        t.colorSetId === "cs-work"
                          ? COLORS.setWork
                          : t.colorSetId === "cs-personal"
                            ? COLORS.setPersonal
                            : t.colorSetId === "cs-sport"
                              ? COLORS.setSport
                              : COLORS.muted,
                    }}
                  />
                  {t.title}
                </div>
              ))}
              {dayTasks.length > 6 && (
                <div style={{ fontSize: "var(--fs-2xs)", color: COLORS.accent, fontWeight: 600 }}>
                  +{dayTasks.length - 6} ещё
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Меню при клике на день */}
      {menuDay && (
        <div
          onClick={() => { setMenuDay(null); setAddTitle(""); }}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,.25)", zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: "var(--radius-xl)", padding: "var(--sp-6)",
              width: 280, boxShadow: "var(--shadow-xl)",
            }}
          >
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: COLORS.text, marginBottom: "var(--sp-4)", textTransform: "capitalize" }}>
              {menuDay.toLocaleDateString("ru", { day: "numeric", month: "long", weekday: "long" })}
            </div>
            <input
              autoFocus
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(menuDay); }}
              placeholder="Добавить задачу на этот день"
              style={{
                width: "100%", fontSize: "var(--fs-sm)",
                border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-md)",
                padding: "var(--sp-2) var(--sp-3)", marginBottom: "var(--sp-4)",
                background: "transparent", color: COLORS.text,
              }}
            />
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button
                onClick={() => addTask(menuDay)}
                style={btnStyle(false)}
              >
                Добавить
              </button>
              <button
                onClick={() => openDay(menuDay)}
                style={btnStyle(true)}
              >
                Перейти к дню
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "var(--sp-2) var(--sp-3)", cursor: "pointer",
    fontSize: "var(--fs-sm)", borderRadius: "var(--radius-md)",
    border: `1px solid ${primary ? COLORS.accent : COLORS.cardBorder}`,
    background: primary ? COLORS.accent : "transparent",
    color: primary ? "#fff" : COLORS.text,
  };
}
