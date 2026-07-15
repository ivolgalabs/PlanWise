import { useRef, useState } from "react";
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

/**
 * Колонка одного дня: заголовок, список строк-задач, поле ввода.
 * Enter в строке создаёт новую строку ниже (расширение).
 */
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
  const newInputRef = useRef<HTMLInputElement>(null);
  const today = isToday(day);
  const weekday = day.toLocaleDateString("ru", { weekday: "short" });
  const dayNum = day.getDate();

  const epochDay = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );

  const addTask = async () => {
    const t = newTitle.trim();
    if (!t) return;
    await api.upsertTask({ title: t, date: epochDay });
    setNewTitle("");
    onChange();
    // Вернуть фокус на поле ввода для непрерывного набора.
    requestAnimationFrame(() => newInputRef.current?.focus());
  };

  /** Создать новую пустую строку после задачи [afterId] и сфокусировать её. */
  const createNext = async (afterId: string) => {
    // sortOrder новой задачи — чуть больше, чем у afterId.
    const after = tasks.find((t) => t.id === afterId);
    const sort = after ? after.sortOrder + 1 : Date.now();
    await api.upsertTask({ title: "", date: epochDay, sortOrder: sort });
    onChange();
    // Фокус новой строки после ре-рендера.
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(
        `input[data-task-id]`,
      );
      // Найдём пустую (только что созданную).
      const empty = Array.from(inputs).find((i) => i.value === "");
      empty?.focus();
    });
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
          <TaskCard
            key={t.id}
            task={t}
            onChange={onChange}
            onDragStart={onDragStart}
            onCreateNext={createNext}
          />
        ))}
      </div>
      <input
        ref={newInputRef}
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
