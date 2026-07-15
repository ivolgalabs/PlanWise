import { useState } from "react";
import type { Task } from "../api";
import { fromEpochDay, api } from "../api";
import { weekDays, isSameDay } from "../date";
import { DayColumn } from "../components/DayColumn";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/** Вид «Неделя» (горизонтальный): 7 колонок с drag-and-drop между днями. */
export function WeekView({ tasks, onChange }: Props) {
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
    <div style={{ display: "flex", gap: 4, padding: 4, height: "100%" }}>
      {days.map((d) => (
        <div key={d.toISOString()} style={{ flex: 1, minWidth: 0 }}>
          <DayColumn
            day={d}
            tasks={tasksForDay(d)}
            onChange={onChange}
            onDragStart={setDragTask}
            onDrop={onDrop}
            onDragOver={setHoverDay}
            hovering={!!hoverDay && isSameDay(hoverDay, d)}
          />
        </div>
      ))}
    </div>
  );
}
