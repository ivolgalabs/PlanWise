import { useRef, useState } from "react";
import type { Task } from "../api";
import { api } from "../api";
import { fromEpochDay } from "../api";
import { TaskCard } from "../components/TaskCard";
import { MiniCalendar } from "../components/MiniCalendar";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  day: Date;
  tasks: Task[];
  onChange: () => void;
}

/**
 * Вид «День»: слева — крупный заголовок + задачи (увеличенный шрифт),
 * справа — мини-календарь (больше обычного) для навигации.
 */
export function DayView({ day, tasks, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);
  const { setSelectedDate } = useStore();

  const dayTasks = tasks
    .filter((t) => {
      const d = fromEpochDay(t.date);
      return (
        d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate()
      );
    })
    .sort((a, b) => {
      // Сначала задачи со временем (по возрастанию), потом без времени.
      const at = a.timeMinutes ?? 9999;
      const bt = b.timeMinutes ?? 9999;
      return at - bt;
    });

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
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Основная область — задачи */}
      <div
        style={{
          flex: 1,
          padding: "var(--sp-6) var(--sp-8)",
          overflowY: "auto",
          minWidth: 0,
        }}
      >
        <h2
          style={{
            fontSize: "var(--fs-xl)",
            fontWeight: 700,
            color: COLORS.text,
            margin: "0 0 var(--sp-6)",
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
            <p style={{ color: COLORS.muted, fontSize: "var(--fs-base)" }}>
              Нет задач. Напишите ниже, чтобы добавить.
            </p>
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

        {/* Inline-поле ввода — крупное */}
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
            padding: "var(--sp-4) var(--sp-2)",
            marginTop: "var(--sp-2)",
            fontSize: "var(--fs-md)",
            background: "transparent",
            outline: "none",
            color: COLORS.text,
          }}
        />
      </div>

      {/* Правая панель — мини-календарь крупнее */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          padding: "var(--sp-6) var(--sp-4)",
          borderLeft: `1px solid ${COLORS.cardBorder}`,
          overflowY: "auto",
        }}
      >
        <MiniCalendar tasks={tasks} large onSelect={(d) => setSelectedDate(d)} />
      </div>
    </div>
  );
}
