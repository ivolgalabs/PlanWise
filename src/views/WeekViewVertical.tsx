import { useState } from "react";
import type { Task } from "../api";
import { fromEpochDay, api } from "../api";
import { weekDays, isSameDay, isToday } from "../date";
import { TaskCard } from "../components/TaskCard";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/** Вид «Неделя» (вертикальный): дни сверху вниз. Для узких экранов. */
export function WeekViewVertical({ tasks, onChange }: Props) {
  const { selectedDate, mondayFirst } = useStore();
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const days = weekDays(selectedDate, mondayFirst);

  const tasksForDay = (d: Date) =>
    tasks.filter((t) => isSameDay(fromEpochDay(t.date), d));

  const onDrop = async (day: Date) => {
    if (dragTask && !isSameDay(fromEpochDay(dragTask.date), day)) {
      await api.moveTask(dragTask.id, day);
      onChange();
    }
    setDragTask(null);
    setHoverDay(null);
  };

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: 8 }}>
      {days.map((d) => {
        const today = isToday(d);
        const hovering = !!hoverDay && isSameDay(hoverDay, d);
        const weekday = d.toLocaleDateString("ru", { weekday: "short" });
        return (
          <div
            key={d.toISOString()}
            onDragOver={(e) => {
              e.preventDefault();
              setHoverDay(d);
            }}
            onDrop={() => onDrop(d)}
            style={{ marginBottom: 8 }}
          >
            <div
              style={{
                padding: "6px 8px",
                fontWeight: 600,
                fontSize: 12,
                color: today ? COLORS.accent : COLORS.muted,
                background: hovering ? COLORS.accent + "14" : "transparent",
                borderRadius: 6,
              }}
            >
              {weekday} {d.getDate()}
              {today && " ●"}
            </div>
            <div style={{ paddingLeft: 12 }}>
              {tasksForDay(d).map((t) => (
                <div key={t.id} style={{ marginBottom: 4 }}>
                  <TaskCard task={t} onChange={onChange} onDragStart={setDragTask} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
