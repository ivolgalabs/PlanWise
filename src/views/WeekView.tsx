import { useState } from "react";
import type { Task } from "../api";
import { fromEpochDay, api } from "../api";
import { weekDays, isSameDay } from "../date";
import { DayColumn } from "../components/DayColumn";
import { MiniCalendar } from "../components/MiniCalendar";
import { WeekViewVertical } from "./WeekViewVertical";
import { COLORS } from "../theme";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/**
 * Вид «Неделя»: дни + правая панель с крупным мини-календарём.
 * Кнопка переключения горизонтально/вертикально.
 */
export function WeekView({ tasks, onChange }: Props) {
  const { selectedDate, mondayFirst, setSelectedDate } = useStore();
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const [vertical, setVertical] = useState(true);
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

  if (vertical) {
    return (
      <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <OrientationToggle vertical={vertical} onToggle={() => setVertical(false)} />
          <div style={{ flex: 1, minHeight: 0 }}>
            <WeekViewVertical tasks={tasks} onChange={onChange} />
          </div>
        </div>
        <RightCalendar tasks={tasks} onSelect={setSelectedDate} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <OrientationToggle vertical={vertical} onToggle={() => setVertical(true)} />
        <div style={{ display: "flex", gap: 4, padding: 4, flex: 1, minHeight: 0 }}>
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
      </div>
      <RightCalendar tasks={tasks} onSelect={setSelectedDate} />
    </div>
  );
}

/** Кнопка переключения ориентации недели. */
function OrientationToggle({
  vertical,
  onToggle,
}: {
  vertical: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", padding: "var(--sp-1) var(--sp-4)" }}>
      <button onClick={onToggle} className="icon-btn" title={vertical ? "Горизонтально" : "Вертикально"} style={{ fontSize: "var(--fs-xs)" }}>
        {vertical ? "▤ списком" : "▥ сеткой"}
      </button>
    </div>
  );
}

/** Правая панель с крупным мини-календарём. */
function RightCalendar({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (d: Date) => void;
}) {
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        padding: "var(--sp-4)",
        borderLeft: `1px solid ${COLORS.cardBorder}`,
        overflowY: "auto",
      }}
    >
      <MiniCalendar tasks={tasks} large onSelect={onSelect} />
    </div>
  );
}
