import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { weekDays, isSameDay, isToday, isPast, dayWeight } from "../date";
import { TaskCard } from "../components/TaskCard";
import { WeekShiftZone } from "../components/WeekShiftZone";
import { COLORS, accentTint } from "../theme";
import { useStore } from "../store";
import { dayId } from "../drag";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/**
 * Вид «Неделя» (вертикальный): дни сверху вниз, с inline-полем ввода
 * в каждом дне и расширяемыми строками. Каждый день — droppable-зона
 * для перетаскивания задач (@dnd-kit).
 */
export function WeekViewVertical({ tasks, onChange }: Props) {
  const { selectedDate, mondayFirst } = useStore();
  const [titlesByDay, setTitlesByDay] = useState<Record<string, string>>({});
  const days = weekDays(selectedDate, mondayFirst);

  const tasksForDay = (d: Date) =>
    tasks
      .filter((t) => isSameDay(fromEpochDay(t.date), d))
      .sort((a, b) => {
        // Порядок — только ручной (sortOrder); время не сортирует.
        return a.sortOrder - b.sortOrder;
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
      // Ищем пустую строку ТОЛЬКО в контейнере своего дня — чтобы фокус
      // не уходил в соседний день с такой же пустой строкой.
      const container = document.querySelector(`[data-day-key="${dayKey(day)}"]`);
      if (!container) return;
      const empty = Array.from(
        container.querySelectorAll<HTMLTextAreaElement>("textarea[data-task-id]"),
      ).find((i) => i.value === "");
      empty?.focus();
    });
  };

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <WeekShiftZone dir={-1} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          padding: "var(--sp-4)",
        }}
      >
        {days.map((d) => (
          <DayRow
            key={d.toISOString()}
            day={d}
            dayKey={dayKey(d)}
            selected={isSameDay(d, selectedDate)}
            dayTasks={tasksForDay(d)}
            onChange={onChange}
            createNext={createNext}
            title={titlesByDay[dayKey(d)] ?? ""}
            setTitle={(v) =>
              setTitlesByDay((m) => ({ ...m, [dayKey(d)]: v }))
            }
            addTask={() => addTask(d)}
          />
        ))}
      </div>
      <WeekShiftZone dir={1} />
    </div>
  );
}

/** Один день-строка: droppable-зона + задачи + inline-поле ввода. */
function DayRow({
  day,
  dayKey,
  selected,
  dayTasks,
  onChange,
  createNext,
  title,
  setTitle,
  addTask,
}: {
  day: Date;
  dayKey: string;
  /** Выбранная дата — рамка акцента, чтобы отличать от «сегодня» (●). */
  selected: boolean;
  dayTasks: Task[];
  onChange: () => void;
  createNext: (afterId: string, day: Date) => void;
  title: string;
  setTitle: (v: string) => void;
  addTask: () => void;
}) {
  const today = isToday(day);
  const past = isPast(day);
  const weight = dayWeight(day);
  const ed = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const { setNodeRef, isOver } = useDroppable({ id: dayId(ed) });
  const weekday = day.toLocaleDateString("ru", { weekday: "short" });
  const inputRef = useRef<HTMLInputElement>(null);

  // Иерархия: past — бледный/компактный, today/tomorrow — крупные.
  const dim = weight === "past" ? 0.4 : weight === "future" ? 0.75 : 1;
  const headFs =
    weight === "past"
      ? "var(--fs-2xs)"
      : weight === "future"
        ? "var(--fs-xs)"
        : weight === "today" || weight === "tomorrow"
          ? "var(--fs-md)"
          : "var(--fs-sm)";
  const headWeight =
    weight === "past" ? 400 : weight === "today" || weight === "tomorrow" ? 700 : 600;
  const headColor =
    weight === "today"
      ? COLORS.accent
      : weight === "tomorrow"
        ? COLORS.text
        : past
          ? COLORS.muted
          : COLORS.secondary;

  return (
    <div
      ref={setNodeRef}
      data-day-key={dayKey}
      style={{
        marginBottom: "var(--sp-4)",
        opacity: dim,
        borderRadius: "var(--radius-md)",
        background: isOver
          ? accentTint(0.08)
          : selected
            ? accentTint(0.05)
            : "transparent",
        // Рамка выбранного дня — отдельный маркер от «сегодня» (● в заголовке).
        border: `1px solid ${selected ? COLORS.accent : "transparent"}`,
      }}
    >
      <div
        style={{
          padding:
            weight === "past"
              ? "var(--sp-1) var(--sp-3)"
              : "var(--sp-2) var(--sp-3)",
          fontWeight: headWeight,
          fontSize: headFs,
          color: headColor,
          textTransform: "capitalize",
        }}
      >
        {past ? "✓ " : ""}
        {`${weekday}, ${day.getDate()}`}
        {today && " ●"}
      </div>
      <div
        style={{
          paddingLeft: "var(--sp-6)",
          // Иерархия: прошедшие дни — мельче шрифт задач, будущие — чуть меньше.
          fontSize:
            weight === "past"
              ? "var(--fs-2xs)"
              : weight === "future"
                ? "var(--fs-xs)"
                : "var(--fs-sm)",
        }}
      >
        {dayTasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onChange={onChange}
            onCreateNext={(id) => createNext(id, day)}
          />
        ))}
        {/* Inline-поле ввода новой задачи */}
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTask();
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
}
