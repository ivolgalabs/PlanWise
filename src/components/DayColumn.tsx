import { useState } from "react";
import type { Task } from "../api";
import { api } from "../api";
import { isToday } from "../date";
import { TaskCard } from "./TaskCard";
import { COLORS } from "../theme";

interface Props {
  day: Date;
  tasks: Task[];
  onChange: () => void;
  onDragStart?: (t: Task) => void;
  onDrop?: (day: Date) => void;
  onDragOver?: (day: Date) => void;
  hovering?: boolean;
}

/** Колонка одного дня: заголовок, список задач, inline-поле ввода.
 * Принимает drop перетаскиваемой задачи. */
export function DayColumn({
  day,
  tasks,
  onChange,
  onDragStart,
  onDrop,
  onDragOver,
  hovering,
}: Props) {
  const [newTitle, setNewTitle] = useState("");
  const today = isToday(day);
  const weekday = day.toLocaleDateString("ru", { weekday: "short" });
  const dayNum = day.getDate();

  const addTask = async () => {
    const t = newTitle.trim();
    if (!t) return;
    const epochDay = Math.floor(
      Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
    );
    await api.upsertTask({ title: t, date: epochDay });
    setNewTitle("");
    onChange();
  };

  return (
    <div
      className="day-column"
      onDragOver={(e) => {
        if (onDrop) {
          e.preventDefault();
          onDragOver?.(day);
        }
      }}
      onDrop={() => onDrop?.(day)}
      style={{
        background: hovering ? COLORS.accent + "14" : COLORS.card,
        border: `${today ? 2 : 1}px solid ${today ? COLORS.accent : COLORS.cardBorder}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div className="day-header" style={{ padding: "4px 8px" }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 11,
            color: today ? COLORS.accent : COLORS.muted,
            textTransform: "uppercase",
          }}
        >
          {weekday}
          {today && " ●"}
        </span>
        <span
          style={{
            float: "right",
            fontSize: 10,
            color: today ? COLORS.accent : COLORS.muted,
          }}
        >
          {dayNum}
        </span>
      </div>
      <div
        className="day-tasks"
        style={{ padding: 4, flex: 1, overflowY: "auto", minHeight: 40 }}
      >
        {tasks.map((t) => (
          <div key={t.id} style={{ marginBottom: 4 }}>
            <TaskCard task={t} onChange={onChange} onDragStart={onDragStart} />
          </div>
        ))}
      </div>
      <input
        className="inline-input"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") addTask();
        }}
        placeholder="+ добавить"
        style={{
          width: "100%",
          border: "none",
          borderTop: `1px solid ${COLORS.cardBorder}`,
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          outline: "none",
        }}
      />
    </div>
  );
}
