import { useEffect, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { startOfWeek, firstOfMonth, isSameDay, isToday, isPast, formatMinutes } from "../date";
import { COLORS, accentTint, setHex, argbToHex } from "../theme";
import { useStore } from "../store";
import { dayId } from "../drag";
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
  const { selectedDate, monthDate, setMonthDate, mondayFirst, colorSets } = useStore();
  // Узкий экран: ячейки-квадраты (иначе дни вытягиваются в высокие колонки,
  // а текст задач обрезается). Квадрат = высота строки равна ширине ячейки.
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 560px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 560px)");
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // Якорь месяца: фиксируем при первом открытии вида — выбор дня в «Дне»
  // не будет двигать месяц (см. store.ts monthDate).
  useEffect(() => {
    if (monthDate === null) setMonthDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  const first = firstOfMonth(monthDate ?? selectedDate);
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
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "var(--sp-4)" }}>
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
      {/* Строки-недели с распределением высоты: текущая неделя крупнее.
          На узком экране строки — квадратные ячейки (aspect-ratio 7/1:
          высота = ширина одной ячейки), сетка не растягивается на весь экран. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: narrow ? undefined : 1,
          minHeight: 0,
          gap: "var(--sp-2)",
          justifyContent: narrow ? "flex-start" : undefined,
        }}
      >
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
                flex: narrow ? undefined : grow,
                // Квадратная ячейка на мобильном: строка-неделя высотой
                // в одну ячейку (ширина / 7).
                aspectRatio: narrow ? "7 / 1" : undefined,
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
                    narrow={narrow}
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
              borderRadius: "var(--radius-md)",
              // Просторная панель: крупный заголовок, поля как в поиске.
              padding: "var(--sp-8)",
              width: 460,
              maxWidth: "92vw",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <div style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: COLORS.text, marginBottom: "var(--sp-5)", textTransform: "capitalize" }}>
              {menuDay.toLocaleDateString("ru", { day: "numeric", month: "long", weekday: "long" })}
            </div>

            {/* Список задач дня: клик — перейти к дню */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", marginBottom: "var(--sp-5)" }}>
              {tasksForDay(menuDay).length === 0 && (
                <p style={{ margin: 0, padding: "var(--sp-1) 0", fontSize: "var(--fs-sm)", color: COLORS.muted }}>
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
                    padding: "var(--sp-2) var(--sp-3)",
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

            {/* Форма: «Далее/Готово» на мобильной клавиатуре добавляет задачу. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addTask(menuDay);
              }}
            >
              <input
                autoFocus
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                enterKeyHint="done"
                placeholder="Добавить задачу на этот день"
                style={{
                  // Поле как в поиске — заметно выше, текст не липнет к краям.
                  width: "100%", fontSize: "var(--fs-md)",
                  border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-md)",
                  padding: "10px 12px", marginBottom: "var(--sp-5)",
                  background: "transparent", color: COLORS.text,
                }}
              />
            </form>
            {/* Время задачи — крупный чип, как остальные поля панели */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
              <span style={{ fontSize: "var(--fs-sm)", color: COLORS.muted, minWidth: "var(--island-h)" }}>Время</span>
              <TimePicker value={addTime} onChange={setAddTime} large />
            </div>
            {/* Цвет (категория) задачи — крупные свотчи с подписями */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-5)" }}>
              <span style={{ fontSize: "var(--fs-sm)", color: COLORS.muted, minWidth: "var(--island-h)" }}>Цвет</span>
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
                  padding: 4,
                }}
              >
                <Icon name="close" size={12} />
              </button>
              {sets.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setAddColor(c.id)}
                  title={c.name}
                  // Без chip-btn: его фиксированный квадрат сжимает колонку
                  // «свотч + подпись».
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "var(--sp-1)",
                    padding: 4,
                    background: "transparent",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    opacity: addColor && addColor !== c.id ? 0.45 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: argbToHex(c.color),
                      border: `2px solid ${addColor === c.id ? COLORS.accent : "transparent"}`,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "var(--fs-xs)",
                      color: COLORS.muted,
                      maxWidth: 48,
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
              <button className="modal-action-btn" onClick={() => addTask(menuDay)} style={btnStyle(false)}>Добавить</button>
              <button className="modal-action-btn" onClick={() => openDay(menuDay)} style={btnStyle(true)}>Перейти к дню</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ячейка дня месяца — droppable-зона для задач. */
function MonthCell({
  day,
  inMonth,
  isCurrentWeek,
  narrow,
  dayTasks,
  onClickDay,
}: {
  day: Date;
  inMonth: boolean;
  isCurrentWeek: boolean;
  /** Узкий экран: компактная ячейка-квадрат, меньше превью. */
  narrow: boolean;
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
  // На узком экране — минимум: ячейка квадратная, превью в одну строку.
  const maxPreview = narrow
    ? isCurrentWeek
      ? past ? 2 : 4
      : past ? 1 : 3
    : isCurrentWeek ? (past ? 6 : 12) : past ? 3 : 6;

  return (
    <div
      ref={setNodeRef}
      onClick={onClickDay}
      style={{
        background: isOver
          ? accentTint(0.12)
          : COLORS.card,
        // Рамки и подсветки выбранного дня нет; «сегодня» — акцентная обводка.
        boxShadow: isTd
          ? `inset 0 0 0 1.5px ${COLORS.accent}`
          : "none",
        borderRadius: "var(--radius-md)",
        padding: narrow ? "2px 3px" : "var(--sp-2)",
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
          fontSize: past ? "var(--fs-2xs)" : narrow ? "var(--fs-xs)" : "var(--fs-sm)",
          fontWeight: 600,
          color: past ? COLORS.muted : COLORS.text,
          marginBottom: narrow ? 0 : "var(--sp-1)",
        }}
      >
        {day.getDate()}
      </div>
      {dayTasks.slice(0, maxPreview).map((t) => (
        <MonthTaskPreview key={t.id} task={t} past={past} narrow={narrow} />
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
function MonthTaskPreview({ task, past, narrow }: { task: Task; past: boolean; narrow: boolean }) {
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
        fontSize: narrow ? "var(--fs-2xs)" : "var(--fs-xs)",
        color: task.isDone ? COLORS.muted : past ? COLORS.muted : COLORS.text,
        textDecoration: task.isDone ? "line-through" : "none",
        whiteSpace: "normal",
        overflow: "hidden",
        display: "flex",
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
          width: narrow ? 4 : 6,
          height: narrow ? 4 : 6,
          borderRadius: "50%",
          flexShrink: 0,
          // Прошлые и выполненные задачи — серые, будущие — в цвете категории.
          background:
            past || task.isDone || !task.colorSetId
              ? COLORS.muted
              : setHex(colorSets, task.colorSetId) ?? COLORS.muted,
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          // На узком экране — одна строка (квадратная ячейка): заголовок не
          // должен уезжать внутрь ячейки и обрезаться невидимо.
          display: "-webkit-box",
          WebkitLineClamp: narrow ? 1 : 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {task.title}
      </span>
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "var(--sp-3) var(--sp-4)", cursor: "pointer",
    fontSize: "var(--fs-sm)", borderRadius: "var(--radius-md)",
    border: `1px solid ${primary ? COLORS.accent : COLORS.cardBorder}`,
    background: primary ? COLORS.accent : "transparent",
    color: primary ? "#fff" : COLORS.text,
  };
}
