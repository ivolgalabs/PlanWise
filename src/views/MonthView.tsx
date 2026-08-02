import { useEffect, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { startOfWeek, firstOfMonth, isSameDay, isToday, isPast, formatMinutes } from "../date";
import { COLORS, accentTint, setHex, argbToHex } from "../theme";
import { useStore } from "../store";
import { TaskDndContext, dayId } from "../drag";
import { TimePicker } from "../components/TimePicker";
import { Icon } from "../components/Icon";

interface Props {
  tasks: Task[];
  onSelectDay: (d: Date) => void;
  onChange: () => void;
}

/**
 * Вид «Месяц»: сетка строк-недель с разной высотой. Строка с сегодняшним днём
 * (текущая неделя) — заметно выше. Прошедшие дни — серее и компактнее.
 * Drag задач между днями — через @dnd-kit.
 */
export function MonthView({ tasks, onSelectDay, onChange }: Props) {
  const { selectedDate, mondayFirst, colorSets } = useStore();
  // Категории для меню добавления (без служебного «Без категории»).
  const sets = colorSets.filter((s) => s.id !== "cs-none");
  const [menuDay, setMenuDay] = useState<Date | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addTime, setAddTime] = useState<number | null>(null);
  const [addColor, setAddColor] = useState<string | null>(null);

  // Escape закрывает модалку добавления.
  useEffect(() => {
    if (!menuDay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuDay(null);
        setAddTitle("");
        setAddTime(null);
        setAddColor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuDay]);

  const first = firstOfMonth(selectedDate);
  const gridStart = startOfWeek(first, mondayFirst);

  const cells: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  // Разбиваем на 6 строк-недель.
  const weeks: Date[][] = Array.from({ length: 6 }, (_, w) =>
    cells.slice(w * 7, w * 7 + 7),
  );

  // Какая строка содержит сегодня — её делаем крупной.
  const todayWeekIdx = weeks.findIndex((wk) =>
    wk.some((d) => isToday(d)),
  );

  const tasksForDay = (d: Date) =>
    tasks.filter((t) => isSameDay(fromEpochDay(t.date), d));

  const weekdays = mondayFirst
    ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    : ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  const openDay = (d: Date) => {
    setMenuDay(null);
    onSelectDay(d);
  };

  const addTask = async (d: Date) => {
    const t = addTitle.trim();
    if (!t) return;
    const epochDay = Math.floor(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
    );
    await api.upsertTask({
      title: t,
      date: epochDay,
      timeMinutes: addTime,
      colorSetId: addColor,
    });
    setAddTitle("");
    setAddTime(null);
    setAddColor(null);
    setMenuDay(null);
    onChange();
  };

  return (
    <TaskDndContext onChange={onChange}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--sp-4)" }}>
        <div style={{ display: "flex" }}>
          {weekdays.map((w) => (
            <div
              key={w}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: "var(--fs-2xs)",
                color: COLORS.muted,
                fontWeight: 600,
                padding: "var(--sp-2) 0",
              }}
            >
              {w}
            </div>
          ))}
        </div>
        {/* Строки-недели с распределением высоты: текущая неделя крупнее. */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: "var(--sp-2)" }}>
          {weeks.map((week, wi) => {
            const isCurrent = wi === todayWeekIdx;
            // Текущая неделя забирает больше места; остальные делят остаток.
            const grow = isCurrent ? 2.2 : 1;
            return (
              <div
                key={wi}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: "var(--sp-2)",
                  flex: grow,
                  minHeight: 0,
                }}
              >
                {week.map((day) => {
                  return (
                    <MonthCell
                      key={day.toISOString()}
                      day={day}
                      inMonth={day.getMonth() === selectedDate.getMonth()}
                      isCurrentWeek={isCurrent}
                      selected={isSameDay(day, selectedDate)}
                      dayTasks={tasksForDay(day)}
                      onClickDay={() => setMenuDay(day)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Меню при клике на день */}
        {menuDay && (
          <div
            onClick={() => { setMenuDay(null); setAddTitle(""); setAddTime(null); setAddColor(null); }}
            style={{
              position: "fixed", inset: 0,
              background: "var(--overlay)", zIndex: 200,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: "var(--radius-xl)",
                padding: "var(--sp-6)",
                width: 460,
                maxWidth: "92vw",
                maxHeight: "85vh",
                overflowY: "auto",
                boxShadow: "var(--shadow-xl)",
              }}
            >
              <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: COLORS.text, marginBottom: "var(--sp-4)", textTransform: "capitalize" }}>
                {menuDay.toLocaleDateString("ru", { day: "numeric", month: "long", weekday: "long" })}
              </div>

              {/* Список задач дня: клик — перейти к дню */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: "var(--sp-4)" }}>
                {tasksForDay(menuDay).length === 0 && (
                  <p style={{ margin: 0, fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                    Нет задач на этот день
                  </p>
                )}
                {tasksForDay(menuDay).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => openDay(menuDay)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-2)",
                      textAlign: "left",
                      padding: "var(--sp-1) var(--sp-2)",
                      borderRadius: "var(--radius-sm)",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "var(--fs-sm)",
                      color: t.isDone ? COLORS.muted : COLORS.text,
                      textDecoration: t.isDone ? "line-through" : "none",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background:
                          t.isDone || !t.colorSetId
                            ? COLORS.muted
                            : setHex(colorSets, t.colorSetId) ?? COLORS.muted,
                      }}
                    />
                    {t.timeMinutes != null && (
                      <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, flexShrink: 0 }}>
                        {formatMinutes(t.timeMinutes)}
                      </span>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                      {t.title}
                    </span>
                  </button>
                ))}
              </div>

              <input
                autoFocus
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addTask(menuDay); }}
                placeholder="Добавить задачу на этот день"
                style={{
                  width: "100%", fontSize: "var(--fs-sm)",
                  border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-md)",
                  padding: "var(--sp-2) var(--sp-3)", marginBottom: "var(--sp-3)",
                  background: "transparent", color: COLORS.text,
                }}
              />
              {/* Время задачи */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
                <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, minWidth: "var(--island-h)" }}>Время</span>
                <TimePicker value={addTime} onChange={setAddTime} />
              </div>
              {/* Цвет (категория) задачи */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
                <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, minWidth: "var(--island-h)" }}>Цвет</span>
                <button
                  onClick={() => setAddColor(null)}
                  title="Без категории"
                  className="chip-btn"
                  style={{
                    background: "transparent",
                    border: `1px solid ${addColor === null ? COLORS.accent : COLORS.cardBorder}`,
                    opacity: addColor === null ? 1 : 0.5,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
                {sets.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setAddColor(c.id)}
                    title={c.name}
                    className="chip-btn"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                      padding: "2px",
                      background: "transparent",
                      border: "none",
                      opacity: addColor && addColor !== c.id ? 0.45 : 1,
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: argbToHex(c.color),
                        border: `2px solid ${addColor === c.id ? COLORS.accent : "transparent"}`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: "var(--fs-2xs)",
                        color: COLORS.muted,
                        maxWidth: 44,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button onClick={() => addTask(menuDay)} style={btnStyle(false)}>Добавить</button>
                <button onClick={() => openDay(menuDay)} style={btnStyle(true)}>Перейти к дню</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TaskDndContext>
  );
}

/** Ячейка дня месяца — droppable-зона для задач. */
function MonthCell({
  day,
  inMonth,
  isCurrentWeek,
  selected,
  dayTasks,
  onClickDay,
}: {
  day: Date;
  inMonth: boolean;
  isCurrentWeek: boolean;
  /** Выбранная дата — лёгкая подсветка, чтобы было видно, что смотрит пользователь. */
  selected: boolean;
  dayTasks: Task[];
  onClickDay: () => void;
}) {
  const isTd = isToday(day);
  const past = isPast(day);
  const ed = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const { setNodeRef, isOver } = useDroppable({ id: dayId(ed) });
  // Текущая неделя показывает больше задач; прошедшие дни — меньше.
  const maxPreview = isCurrentWeek ? (past ? 6 : 12) : past ? 3 : 6;

  return (
    <div
      ref={setNodeRef}
      onClick={onClickDay}
      style={{
        background: isOver
          ? accentTint(0.12)
          : selected
            ? accentTint(0.08)
            : COLORS.card,
        border: `${isTd ? 2 : 1}px solid ${isTd ? COLORS.accent : COLORS.cardBorder}`,
        borderRadius: "var(--radius-md)",
        padding: "var(--sp-2)",
        cursor: "pointer",
        opacity: !inMonth ? 0.35 : past ? 0.55 : 1,
        minHeight: 0,
        overflow: "hidden",
        position: "relative",
        filter: past ? "saturate(0.6)" : "none",
      }}
    >
      <div
        style={{
          fontSize: past ? "var(--fs-2xs)" : "var(--fs-sm)",
          fontWeight: 600,
          color: past ? COLORS.muted : COLORS.text,
          marginBottom: "var(--sp-1)",
        }}
      >
        {day.getDate()}
      </div>
      {dayTasks.slice(0, maxPreview).map((t) => (
        <MonthTaskPreview key={t.id} task={t} past={past} />
      ))}
      {dayTasks.length > maxPreview && (
        <div style={{ fontSize: "var(--fs-xs)", color: COLORS.accent, fontWeight: 600, marginTop: 1 }}>
          +{dayTasks.length - maxPreview} ещё
        </div>
      )}
    </div>
  );
}

/** Draggable-превью задачи в ячейке месяца. */
function MonthTaskPreview({ task, past }: { task: Task; past: boolean }) {
  const { colorSets } = useStore();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: 0.6 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        alignItems: "center",
        gap: 4,
        fontSize: "var(--fs-xs)",
        color: task.isDone ? COLORS.muted : past ? COLORS.muted : COLORS.text,
        textDecoration: task.isDone ? "line-through" : "none",
        whiteSpace: "normal",
        overflow: "hidden",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        lineHeight: 1.4,
        padding: "1px 0",
        cursor: "grab",
        opacity: isDragging ? 0.3 : undefined,
        touchAction: "none",
        ...style,
      }}
      title="Перетащите на другой день"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          // Прошлые и выполненные задачи — серые, будущие — в цвете категории.
          background:
            past || task.isDone || !task.colorSetId
              ? COLORS.muted
              : setHex(colorSets, task.colorSetId) ?? COLORS.muted,
        }}
      />
      {task.title}
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "var(--sp-2) var(--sp-3)", cursor: "pointer",
    fontSize: "var(--fs-sm)", borderRadius: "var(--radius-md)",
    border: `1px solid ${primary ? COLORS.accent : COLORS.cardBorder}`,
    background: primary ? COLORS.accent : "transparent",
    color: primary ? "#fff" : COLORS.text,
  };
}
