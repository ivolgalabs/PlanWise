import { useRef, useState } from "react";
import type { Task } from "../api";
import { api } from "../api";
import { fromEpochDay } from "../api";
import { TaskCard } from "../components/TaskCard";
import { COLORS } from "../theme";

interface Props {
  day: Date;
  tasks: Task[];
  onChange: () => void;
}

/**
 * Вид «День»: заголовок + строки задач + inline-поле ввода.
 * Enter в строке создаёт новую ниже (как в DayColumn).
 */
export function DayView({ day, tasks, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  const dayTasks = tasks
    .filter((t) => {
      const d = fromEpochDay(t.date);
      return (
        d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate()
      );
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const epochDay = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );

  const addTask = async () => {
    const t = newTitle.trim();
    if (!t) return;
    await api.upsertTask({ title: t, date: epochDay });
    setNewTitle("");
    onChange();
    requestAnimationFrame(() => newInputRef.current?.focus());
  };

  const createNext = async (afterId: string) => {
    const after = dayTasks.find((t) => t.id === afterId);
    const sort = after ? after.sortOrder + 1 : Date.now();
    await api.upsertTask({ title: "", date: epochDay, sortOrder: sort });
    onChange();
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(
        "input[data-task-id]",
      );
      const empty = Array.from(inputs).find((i) => i.value === "");
      empty?.focus();
    });
  };

  return (
    <div
      style={{
        padding: "12px 16px",
        overflowY: "auto",
        height: "100%",
        maxWidth: 640,
      }}
    >
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: COLORS.text,
          margin: "0 0 12px",
          textTransform: "capitalize",
        }}
      >
        {day.toLocaleDateString("ru", {
          day: "numeric",
          month: "long",
          weekday: "long",
        })}
      </h2>

      <div>
        {dayTasks.length === 0 && (
          <p style={{ color: COLORS.muted, fontSize: 13 }}>Нет задач</p>
        )}
        {dayTasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onChange={onChange}
            onCreateNext={createNext}
          />
        ))}
      </div>

      {/* Inline-поле ввода */}
      <input
        ref={newInputRef}
        className="inline-input"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") addTask();
        }}
        placeholder="+ добавить задачу"
        style={{
          width: "100%",
          border: "none",
          borderTop: `1px solid ${COLORS.cardBorder}`,
          padding: "8px 4px",
          marginTop: 4,
          fontSize: 13,
          background: "transparent",
          outline: "none",
          color: COLORS.text,
        }}
      />
    </div>
  );
}
