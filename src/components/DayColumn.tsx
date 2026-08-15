import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { isToday, isPast, dayWeight } from "../date";
import { TaskCard } from "./TaskCard";
import { COLORS, accentTint } from "../theme";
import { dayId } from "../drag";

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
  const today = isToday(day);
  const past = isPast(day);
  const weight = dayWeight(day);
  const weekday = day.toLocaleDateString("ru", { weekday: "short" });
  const dayNum = day.getDate();
  // Иерархия по весу дня: past — бледный/компактный, today/tomorrow — крупные,
  // остальные будущие — одинаково нормальные (иначе пятница яркая, а суббота
  // вдруг серая — без понятной пользователю причины).
  const dim = weight === "past" ? 0.4 : 1;
  // Размеры заголовка зависят от веса.
  const headPad =
    weight === "past"
      ? "var(--sp-1) var(--sp-2)"
      : weight === "today" || weight === "tomorrow"
        ? "var(--sp-2) var(--sp-3)"
        : "var(--sp-1) var(--sp-3)";
  const headFs = weight === "past" ? "var(--fs-2xs)" : "var(--fs-sm)";
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

  return (
    <div
      ref={setNodeRef}
      data-day-key={dayKey}
      className="day-column"
      style={{
        // flex:1 вместо height:100% — см. DayView (zoom-совместимость).
        flex: 1,
        minHeight: 0,
        background: isOver
          ? accentTint(0.08)
          : past
            ? COLORS.tertiary
            : COLORS.card,
        // Рамка и подсветка — только у «сегодня»; выбранный в «Дне» день
        // не переносится в неделю (по желанию пользователя).
        border: today ? `2px solid ${COLORS.accent}` : "none",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
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
            color: today ? "var(--accent-text)" : past ? COLORS.muted : COLORS.secondary,
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
        onClick={(e) => {
          // Клик по ПУСТОЙ части ячейки дня (мимо задач) — то же, что клик
          // по «+ добавить»: фокус в поле ввода внизу колонки. Печатаешь и
          // Enter — задача попадает в этот день.
          if (e.target !== e.currentTarget) return;
          const inp = newInputRef.current;
          if (inp) {
            inp.focus();
            inp.scrollIntoView({ block: "nearest" });
          }
        }}
        style={{
          padding: 4,
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          cursor: "text",
          // Иерархия: прошедшие дни — мельче шрифт задач (fs-sm), остальные —
          // обычный (fs-md). Мелкие задачи (fs-2xs) нечитаемы при окне 1100px.
          fontSize: weight === "past" ? "var(--fs-sm)" : "var(--fs-md)",
        }}
      >
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onChange={onChange}
            compact
            // Без onCreateNext: в компактной сетке Enter просто сохраняет
            // задачу и НЕ создаёт новую пустую строку ниже (иначе каждая
            // задача «плодила» пустую). Новые задачи — полем «+ добавить»
            // внизу колонки.
          />
        ))}
      </div>
      {/* Форма: «Далее/Готово» на мобильной клавиатуре добавляет задачу. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTask();
        }}
      >
        <input
          ref={newInputRef}
          className="inline-input"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          enterKeyHint="done"
          placeholder="+ добавить"
          style={{
            width: "100%",
            border: "none",
            borderTop: `1px solid var(--border-color)`,
            padding: "4px 8px",
            fontSize: 12,
            background: "transparent",
            outline: "none",
          }}
        />
      </form>
    </div>
  );
}
