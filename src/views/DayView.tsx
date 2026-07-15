import type { Task } from "../api";
import { fromEpochDay } from "../api";
import { TaskCard } from "../components/TaskCard";
import { COLORS } from "../theme";

interface Props {
  day: Date;
  tasks: Task[];
  onChange: () => void;
}

/** Вид «День»: крупный заголовок + все задачи списком. */
export function DayView({ day, tasks, onChange }: Props) {
  const dayTasks = tasks.filter((t) => {
    const d = fromEpochDay(t.date);
    return (
      d.getFullYear() === day.getFullYear() &&
      d.getMonth() === day.getMonth() &&
      d.getDate() === day.getDate()
    );
  });
  return (
    <div style={{ padding: 12, overflowY: "auto", height: "100%" }}>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: COLORS.text,
          margin: 0,
        }}
      >
        {day.toLocaleDateString("ru", {
          day: "numeric",
          month: "long",
          weekday: "long",
        })}
      </h2>
      <div style={{ marginTop: 12 }}>
        {dayTasks.length === 0 && (
          <p style={{ color: COLORS.muted }}>Нет задач</p>
        )}
        {dayTasks.map((t) => (
          <div key={t.id} style={{ marginBottom: 6 }}>
            <TaskCard task={t} onChange={onChange} />
          </div>
        ))}
      </div>
    </div>
  );
}
