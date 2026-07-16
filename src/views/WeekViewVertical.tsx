import { useState } from "react";
import type { Task } from "../api";
import { fromEpochDay, api } from "../api";
import { weekDays, isSameDay, isToday, isPast } from "../date";
import { TaskCard } from "../components/TaskCard";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/**
 * Вид «Неделя» (вертикальный): дни сверху вниз, с inline-полем ввода
 * в каждом дне, расширяемыми строками и перетаскиванием.
 */
export function WeekViewVertical({ tasks, onChange }: Props) {
  const { selectedDate, mondayFirst } = useStore();
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const [titlesByDay, setTitlesByDay] = useState<Record<string, string>>({});
  const days = weekDays(selectedDate, mondayFirst);

  const tasksForDay = (d: Date) =>
    tasks
      .filter((t) => isSameDay(fromEpochDay(t.date), d))
      .sort((a, b) => {
        const at = a.timeMinutes ?? 9999;
        const bt = b.timeMinutes ?? 9999;
        return at - bt;
      });

  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const epochDay = (d: Date) =>
    Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

  const addTask = async (d: Date) => {
    const title = (titlesByDay[dayKey(d)] ?? "").trim();
    if (!title) return;
    await api.upsertTask({ title, date: epochDay(d) });
    setTitlesByDay((m) => ({ ...m, [dayKey(d)]: "" }));
    onChange();
  };

  const createNext = async (afterId: string, day: Date) => {
    const dayTasks = tasksForDay(day);
    const after = dayTasks.find((t) => t.id === afterId);
    const sort = after ? after.sortOrder + 1 : Date.now();
    await api.upsertTask({ title: "", date: epochDay(day), sortOrder: sort });
    onChange();
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(
        "input[data-task-id]",
      );
      const empty = Array.from(inputs).find((i) => i.value === "");
      empty?.focus();
    });
  };

  const onDrop = async (day: Date) => {
    if (dragTask && !isSameDay(fromEpochDay(dragTask.date), day)) {
      await api.moveTask(dragTask.id, day);
      onChange();
    }
    setDragTask(null);
    setHoverDay(null);
  };

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "var(--sp-4)" }}>
      {days.map((d) => {
        const today = isToday(d);
        const past = isPast(d);
        const hovering = !!hoverDay && isSameDay(hoverDay, d);
        const weekday = d.toLocaleDateString("ru", { weekday: "short" });
        const dayTasks = tasksForDay(d);
        const k = dayKey(d);
        return (
          <div
            key={d.toISOString()}
            onDragOver={(e) => {
              e.preventDefault();
              setHoverDay(d);
            }}
            onDrop={() => onDrop(d)}
            style={{
              marginBottom: "var(--sp-4)",
              opacity: past ? 0.6 : 1,
            }}
          >
            <div
              style={{
                padding: "var(--sp-2) var(--sp-3)",
                fontWeight: 600,
                fontSize: "var(--fs-sm)",
                color: today ? COLORS.accent : past ? COLORS.muted : COLORS.secondary,
                background: hovering ? COLORS.accent + "14" : "transparent",
                borderRadius: "var(--radius-md)",
                textTransform: "capitalize",
              }}
            >
              {past ? "✓ " : ""}
              {weekday} {d.getDate()}
              {today && " ●"}
            </div>
            <div style={{ paddingLeft: "var(--sp-6)" }}>
              {dayTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onChange={onChange}
                  onDragStart={setDragTask}
                  onCreateNext={(id) => createNext(id, d)}
                />
              ))}
              {/* Inline-поле ввода нового задачи */}
              <input
                value={titlesByDay[k] ?? ""}
                onChange={(e) =>
                  setTitlesByDay((m) => ({ ...m, [k]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTask(d);
                }}
                placeholder="+ добавить"
                className="inline-input"
                style={{
                  width: "100%",
                  border: "none",
                  borderTop: `1px solid ${COLORS.cardBorder}`,
                  padding: "var(--sp-2) var(--sp-1)",
                  fontSize: "var(--fs-sm)",
                  background: "transparent",
                  outline: "none",
                  color: COLORS.text,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
