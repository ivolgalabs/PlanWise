import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { fromEpochDay } from "../api";
import {
  startOfWeek,
  firstOfMonth,
  isSameDay,
  isPast,
  weekDays,
} from "../date";
import { COLORS, setHex, accentTint, varTint } from "../theme";
import { useStore } from "../store";
import { calendarDayId } from "../drag";

interface Props {
  tasks: Task[];
  /** Крупный режим (для боковой панели DayView). */
  large?: boolean;
  /** Колбэк выбора дня (если не задан — использует store.setSelectedDate). */
  onSelect?: (d: Date) => void;
  /**
   * Являются ли ячейки droppable-целями для drag задач?
   * true — в DayView (календарь как цель переноса на произвольный день).
   * false — в WeekView, чтобы ячейки не перехватывали collision у дней недели.
   */
  droppable?: boolean;
}

/** Максимум точек-задач в ячейке; остаток показываем как «+N». */
const MAX_DOTS = 4;

/**
 * Мини-календарь месяца с точками-задачами: задачи в прошедших днях — серые,
 * в сегодня/будущем — в цвете выбранной пользователем категории (несколько
 * задач — несколько цветов). В виде «Неделя» подсвечивается неделя выбранной
 * даты, в «Дне» — сам выбранный день.
 */
export function MiniCalendar({ tasks, large, onSelect, droppable = true }: Props) {
  const { selectedDate, setSelectedDate, mondayFirst, view } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  // Месяц календаря — собственное состояние, отвязанное от выбранной даты:
  // можно свободно листать вперёд/назад, не сдвигая выбранный день.
  const [calMonth, setCalMonth] = useState<Date>(() => firstOfMonth(selectedDate));
  const first = firstOfMonth(calMonth);
  const gridStart = startOfWeek(first, mondayFirst);

  // Неделя выбранной даты — подсветка в виде «Неделя», чтобы было видно,
  // какой диапазон пользователь сейчас смотрит.
  const selectedWeek =
    view === "week" ? weekDays(selectedDate, mondayFirst) : null;

  const tasksForDay = (d: Date): Task[] =>
    tasks.filter((t) => isSameDay(fromEpochDay(t.date), d));

  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const pick = (d: Date) => {
    const clean = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (onSelect) onSelect(clean);
    else setSelectedDate(clean);
  };

  // Масштаб: large — крупнее шрифт/ячейки.
  const fs = large ? "var(--fs-sm)" : 9;
  const cellPad = large ? "8px 0" : "3px 0";
  const monthFs = large ? "var(--fs-md)" : 11;

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: "var(--radius-lg)",
        padding: large ? "var(--sp-6)" : 10,
      }}
    >
      <div
        style={{
          fontSize: monthFs,
          fontWeight: 600,
          color: COLORS.text,
          marginBottom: "var(--sp-4)",
          textTransform: "capitalize",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-1)",
          userSelect: "none",
        }}
      >
        <button
          className="icon-btn"
          onClick={() =>
            setCalMonth(
              new Date(first.getFullYear(), first.getMonth() - 1, 1),
            )
          }
          title="Предыдущий месяц"
          style={{ fontSize: large ? "var(--fs-xs)" : 11, padding: "0 4px" }}
        >
          ‹
        </button>
        <span
          style={{ cursor: "pointer", flex: 1, textAlign: "center" }}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Развернуть" : "Свернуть"}
        >
          {first.toLocaleDateString("ru", { month: "long", year: "numeric" })}
        </span>
        <button
          className="icon-btn"
          onClick={() =>
            setCalMonth(
              new Date(first.getFullYear(), first.getMonth() + 1, 1),
            )
          }
          title="Следующий месяц"
          style={{ fontSize: large ? "var(--fs-xs)" : 11, padding: "0 4px" }}
        >
          ›
        </button>
      </div>
      {/* Быстрый возврат к сегодняшнему дню/месяцу. */}
      {!collapsed && (
        <button
          className="icon-btn"
          onClick={() => {
            const today = new Date();
            setCalMonth(firstOfMonth(today));
            setSelectedDate(today);
          }}
          style={{
            fontSize: large ? "var(--fs-2xs)" : 9,
            marginBottom: "var(--sp-2)",
            padding: "2px 6px",
            alignSelf: "flex-start",
          }}
          title="Перейти к сегодняшнему дню"
        >
          Сегодня
        </button>
      )}
      {!collapsed && (
        <>
      <div style={{ display: "flex", marginBottom: 6 }}>
        {["П", "В", "С", "Ч", "П", "С", "В"].map((w, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: large ? "var(--fs-2xs)" : 8,
              color: COLORS.muted,
            }}
          >
            {w}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: large ? 3 : 2,
        }}
      >
        {cells.map((day, i) => {
          const inMonth = day.getMonth() === first.getMonth();
          const selected = isSameDay(day, selectedDate);
          const inSelectedWeek =
            selectedWeek?.some((w) => isSameDay(w, day)) ?? false;
          const past = isPast(day);
          return (
            <CalendarDayCell
              key={i}
              day={day}
              inMonth={inMonth}
              selected={selected}
              inSelectedWeek={inSelectedWeek}
              past={past}
              dayTasks={tasksForDay(day)}
              large={large}
              fs={fs}
              cellPad={cellPad}
              droppable={droppable}
              onPick={pick}
            />
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}

/** Ячейка дня календаря — droppable-зона для переноса задач (@dnd-kit),
 *  если droppable=true. В WeekView отключается (droppable=false), чтобы ячейки
 *  не перехватывали collision у дней недели. */
function CalendarDayCell({
  day,
  inMonth,
  selected,
  inSelectedWeek,
  past,
  dayTasks,
  large,
  fs,
  cellPad,
  droppable,
  onPick,
}: {
  day: Date;
  inMonth: boolean;
  selected: boolean;
  inSelectedWeek: boolean;
  past: boolean;
  dayTasks: Task[];
  large?: boolean;
  fs: number | string;
  cellPad: string;
  droppable: boolean;
  onPick: (d: Date) => void;
}) {
  const epochDay = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const { setNodeRef, isOver } = useDroppable({
    // dc: — отдельное пространство имён, чтобы ячейка календаря не конфликтовала
    // с основной droppable-зоной того же дня (d:). См. calendarDayId в drag.tsx.
    id: calendarDayId(epochDay),
    disabled: !droppable,
  });
  return (
    <div
      ref={setNodeRef}
      onClick={() => onPick(day)}
      style={{
        textAlign: "center",
        padding: cellPad,
        cursor: "pointer",
        borderRadius: "var(--radius-sm)",
        // Приоритет подсветки: drop-цель > выбранный день > выбранная неделя.
        background: isOver
          ? accentTint(0.25)
          : selected
            ? accentTint(0.15)
            : inSelectedWeek
              ? accentTint(0.08)
              : "transparent",
        outline: isOver ? `2px solid ${COLORS.accent}` : "none",
      }}
    >
      <div
        style={{
          fontSize: fs,
          fontWeight: selected ? 700 : 400,
          color: inMonth
            ? selected
              ? COLORS.accent
              : COLORS.text
            : varTint("--text-muted", 0.4),
        }}
      >
        {day.getDate()}
      </div>
              <DayDots dayTasks={dayTasks} past={past} large={large} />
    </div>
  );
}

/** Точки-задачи дня: в прошлом и выполненные — серые, будущие — в цвете
 *  выбранной пользователем категории; задачи без категории — нейтральные. */
function DayDots({
  dayTasks,
  past,
  large,
}: {
  dayTasks: Task[];
  past: boolean;
  large?: boolean;
}) {
  const { colorSets } = useStore();
  const sz = large ? 4 : 3;
  const visible = dayTasks.slice(0, MAX_DOTS);
  const rest = dayTasks.length - visible.length;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 2,
        marginTop: 2,
        minHeight: sz,
        flexWrap: "wrap",
      }}
    >
      {visible.map((t) => (
        <div
          key={t.id}
          title={t.title || undefined}
          style={{
            width: sz,
            height: sz,
            borderRadius: "50%",
            flexShrink: 0,
            background:
              past || t.isDone || !t.colorSetId
                ? COLORS.muted
                : setHex(colorSets, t.colorSetId) ?? COLORS.muted,
          }}
        />
      ))}
      {rest > 0 && (
        <span
          style={{
            fontSize: large ? "var(--fs-2xs)" : 7,
            lineHeight: 1,
            color: COLORS.muted,
          }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
