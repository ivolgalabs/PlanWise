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
 * Вид «Неделя»: дни + (опциональная) правая панель с календарём.
 * Кнопки: переключение горизонтально/вертикально, скрыть/показать календарь.
 */
export function WeekView({ tasks, onChange }: Props) {
  const { selectedDate, mondayFirst, setSelectedDate } = useStore();
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const [vertical, setVertical] = useState(true);
  const [showCalendar, setShowCalendar] = useState(true);
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
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Toolbar
          vertical={vertical}
          onToggleOrientation={() => setVertical((v) => !v)}
          showCalendar={showCalendar}
          onToggleCalendar={() => setShowCalendar((v) => !v)}
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          {vertical ? (
            <WeekViewVertical tasks={tasks} onChange={onChange} />
          ) : (
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
          )}
        </div>
      </div>
      {showCalendar && <RightCalendar tasks={tasks} onSelect={setSelectedDate} />}
    </div>
  );
}

/** Панель кнопок недели. */
function Toolbar({
  vertical,
  onToggleOrientation,
  showCalendar,
  onToggleCalendar,
}: {
  vertical: boolean;
  onToggleOrientation: () => void;
  showCalendar: boolean;
  onToggleCalendar: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: "var(--sp-2)",
        padding: "var(--sp-1) var(--sp-4)",
      }}
    >
      <button
        onClick={onToggleOrientation}
        className="icon-btn"
        title={vertical ? "Сетка (горизонтально)" : "Список (вертикально)"}
        style={{ fontSize: "var(--fs-xs)" }}
      >
        {vertical ? "▥ сеткой" : "▤ списком"}
      </button>
      <button
        onClick={onToggleCalendar}
        className="icon-btn"
        title={showCalendar ? "Скрыть календарь" : "Показать календарь"}
        style={{ fontSize: "var(--fs-xs)" }}
      >
        {showCalendar ? "▤⊨" : "▤"}
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
