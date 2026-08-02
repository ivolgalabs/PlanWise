import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { isToday, isPast, isSameDay, dayWeight } from "../date";
import { TaskCard } from "./TaskCard";
import { COLORS, accentTint } from "../theme";
import { dayId } from "../drag";
import { useStore } from "../store";

interface Props {
  day: Date;
  tasks: Task[];
  onChange: () => void;
}

/**
 * Колонка одного дня: заголовок, список строк-задач, поле ввода.
 * Enter в строке создаёт новую строку ниже (расширение).
 * Является droppable-зоной для dnd-kit (задачи перетаскиваются между колонками).
 */
export function DayColumn({
  day,
  tasks,
  onChange,
}: Props) {
  const [newTitle, setNewTitle] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);
  const { selectedDate } = useStore();
  const today = isToday(day);
  // Выбранная дата — рамка акцента (отдельно от «сегодня» ●).
  const selected = isSameDay(day, selectedDate);
  const past = isPast(day);
  const weight = dayWeight(day);
  const weekday = day.toLocaleDateString("ru", { weekday: "short" });
  const dayNum = day.getDate();
  // Иерархия по весу дня: past — бледный/компактный, today/tomorrow — крупные,
  // near — нормальный, future — слегка уменьшенный.
  const dim = weight === "past" ? 0.4 : weight === "future" ? 0.7 : 1;
  // Размеры заголовка зависят от веса.
  const headPad =
    weight === "past"
      ? "var(--sp-1) var(--sp-2)"
      : weight === "future"
        ? "var(--sp-1) var(--sp-3)"
        : "var(--sp-2) var(--sp-3)";
  const headFs =
    weight === "past"
      ? "var(--fs-2xs)"
      : weight === "future"
        ? "var(--fs-xs)"
        : "var(--fs-sm)";
  const headWeight = weight === "past" ? 400 : weight === "today" || weight === "tomorrow" ? 700 : 600;

  const epochDay = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;

  // Зона приёма задач: подсвечивается при наведении (isOver).
  const { setNodeRef, isOver } = useDroppable({ id: dayId(epochDay) });

  const addTask = async () => {
    const t = newTitle.trim();
    if (!t) return;
    await api.upsertTask({ title: t, date: epochDay });
    setNewTitle("");
    onChange();
    // Вернуть фокус на поле ввода для непрерывного набора.
    requestAnimationFrame(() => newInputRef.current?.focus());
  };

  /** Создать новую пустую строку после задачи [afterId] и сфокусировать её. */
  const createNext = async (afterId: string) => {
    // sortOrder новой задачи — чуть больше, чем у afterId.
    const after = tasks.find((t) => t.id === afterId);
    const sort = after ? after.sortOrder + 1 : Date.now();
    await api.upsertTask({ title: "", date: epochDay, sortOrder: sort });
    onChange();
    // Фокус новой строки после ре-рендера — ищем ТОЛЬКО внутри своей колонки
    // (data-day-key), чтобы не сфокусировать пустую строку соседнего дня.
    // В компактной сетке поле задачи — textarea, поэтому ищем оба варианта.
    requestAnimationFrame(() => {
      const container = document.querySelector(`[data-day-key="${dayKey}"]`);
      if (!container) return;
      const empty = Array.from(
        container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input[data-task-id], textarea[data-task-id]",
        ),
      ).find((i) => i.value === "");
      empty?.focus();
    });
  };

  return (
    <div
      ref={setNodeRef}
      data-day-key={dayKey}
      className="day-column"
      style={{
        height: "100%",
        background: isOver
          ? accentTint(0.08)
          : selected && !today
            ? accentTint(0.06)
            : past
              ? COLORS.tertiary
              : COLORS.card,
        border: `${today || selected ? 2 : 1}px solid ${
          today || selected ? COLORS.accent : COLORS.cardBorder
        }`,
        borderRadius: "var(--radius-lg)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        opacity: dim,
      }}
    >
      <div
        className="day-header"
        style={{
          padding: headPad,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--sp-1)",
        }}
      >
        <span
          style={{
            fontWeight: headWeight,
            fontSize: headFs,
            color: today ? COLORS.accent : past ? COLORS.muted : COLORS.secondary,
            textTransform: "capitalize",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {past ? "✓ " : ""}
          {`${weekday}, ${dayNum}`}
          {today && " ●"}
        </span>
      </div>
      <div
        className="day-tasks"
        style={{
          padding: 4,
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          // Иерархия: прошедшие дни — мельче шрифт задач, будущие — чуть меньше.
          fontSize:
            weight === "past"
              ? "var(--fs-2xs)"
              : weight === "future"
                ? "var(--fs-xs)"
                : "var(--fs-sm)",
        }}
      >
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onChange={onChange}
            onCreateNext={createNext}
            compact
          />
        ))}
      </div>
      <input
        ref={newInputRef}
        className="inline-input"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") addTask();
        }}
        placeholder="+ добавить"
        style={{
          width: "100%",
          border: "none",
          borderTop: `1px solid ${COLORS.cardBorder}`,
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          outline: "none",
        }}
      />
    </div>
  );
}
