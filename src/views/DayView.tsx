import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { TaskCard } from "../components/TaskCard";
import { COLORS, accentTint } from "../theme";
import { dayId } from "../drag";
import { isToday } from "../date";

interface Props {
  day: Date;
  tasks: Task[];
  onChange: () => void;
}

/**
 * Вид «День»: слева — крупный заголовок + задачи, справа — мини-календарь.
 * Задачи можно перетаскивать на соседние дни через боковые drop-зоны
 * (◀ вчера / завтра ▶) и на любой день в мини-календаре.
 */
export function DayView({ day, tasks, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  // В совсем узком окне прячем и боковую зону «завтра».
  const [tiny, setTiny] = useState(
    () => window.matchMedia("(max-width: 560px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 560px)");
    const handler = (e: MediaQueryListEvent) => setTiny(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
      // Порядок — только ручной (sortOrder); время не сортирует.
      return a.sortOrder - b.sortOrder;
    });

  const epochDay = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;

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
      // Ищем пустую строку ТОЛЬКО в контейнере своего дня (data-day-key) —
      // как в DayColumn/WeekViewVertical, чтобы фокус не уходил в чужой список.
      const container = document.querySelector(`[data-day-key="${dayKey}"]`);
      if (!container) return;
      const empty = Array.from(
        container.querySelectorAll<HTMLTextAreaElement>("textarea[data-task-id]"),
      ).find((i) => i.value === "");
      empty?.focus();
    });
  };

  // Завтра — для боковой drop-зоны (перенос задачи/подзадачи на завтра).
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);

  return (
    // flex:1 вместо height:100% — процентная высота при zoom (uiScale > 1)
    // масштабируется дважды, и панель с архивом вылезает за край окна.
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Основная область — задачи */}
      <DayTasksArea
        day={day}
        dayTasks={dayTasks}
        onChange={onChange}
        createNext={createNext}
        newTitle={newTitle}
        setNewTitle={setNewTitle}
        addTask={addTask}
        newInputRef={newInputRef}
      />
      {/* Боковая зона «завтра» — перенос задачи/подзадачи на завтра;
          в узком окне (tiny) скрыта, чтобы не красть ширину у задач */}
      {!tiny && <SideDayZone day={nextDay} label="завтра ▶" />}
    </div>
  );
}

/** Боковая узкая зона для переноса задачи на соседний день. */
function SideDayZone({ day, label }: { day: Date; label: string }) {
  const ed = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const { setNodeRef, isOver } = useDroppable({ id: dayId(ed) });
  return (
    <div
      ref={setNodeRef}
      style={{
        width: 38,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        writingMode: "vertical-rl",
        fontSize: "var(--fs-2xs)",
        fontWeight: 600,
        color: isOver ? COLORS.accent : COLORS.muted,
        background: isOver ? accentTint(0.12) : "transparent",
        border: `1px dashed ${isOver ? COLORS.accent : COLORS.cardBorder}`,
        borderRadius: "var(--radius-md)",
        margin: "var(--sp-2)",
        userSelect: "none",
      }}
      title={`Перетащите на ${day.toLocaleDateString("ru", { day: "numeric", month: "long" })}`}
    >
      {label}
    </div>
  );
}

/** Основная колонка задач дня (не droppable — дни в DayView обслуживает календарь). */
function DayTasksArea({
  day,
  dayTasks,
  onChange,
  createNext,
  newTitle,
  setNewTitle,
  addTask,
  newInputRef,
}: {
  day: Date;
  dayTasks: Task[];
  onChange: () => void;
  createNext: (afterId: string) => void;
  newTitle: string;
  setNewTitle: (v: string) => void;
  addTask: () => void;
  newInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  // НЕ useDroppable: в DayView droppable-дни обслуживает MiniCalendar (ячейки)
  // и SideDayZone (завтра). Здесь droppable с dayId(epochDay) дублировал бы
  // ячейку календаря того же дня → @dnd-kit перезаписывал ref, ломая drag.
  const today = isToday(day);
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  return (
    <div
      data-day-key={dayKey}
      style={{
        flex: 1,
        padding: "var(--sp-6) var(--sp-8)",
        overflowY: "auto",
        minWidth: 0,
        // Тонкая акцентная полоса слева для текущего дня.
        boxShadow: today ? `inset 3px 0 0 ${COLORS.accent}` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", margin: "0 0 var(--sp-6)" }}>
        <h2
          style={{
            fontSize: "var(--fs-xl)",
            fontWeight: 700,
            color: today ? COLORS.accent : COLORS.text,
            margin: 0,
            textTransform: "capitalize",
          }}
        >
          {day.toLocaleDateString("ru", {
            day: "numeric",
            month: "long",
            weekday: "long",
          })}
          {today && " ●"}
        </h2>
      </div>

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
  );
}
