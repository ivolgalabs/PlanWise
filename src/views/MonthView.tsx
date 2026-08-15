import { useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task, Subtask } from "../api";
import { api, fromEpochDay } from "../api";
import { startOfWeek, firstOfMonth, isSameDay, isToday, isPast, formatMinutes, sortTasksByMode } from "../date";
import { COLORS, accentTint, setHex } from "../theme";
import { useStore } from "../store";
import { dayId } from "../drag";
import { TaskFormFields } from "../components/AddTaskModal";

interface Props {
  tasks: Task[];
  onSelectDay: (d: Date) => void;
  /** Перейти к неделе с этим днём (кнопка «К неделе» в окне дня). */
  onSelectWeek: (d: Date) => void;
  onChange: () => void;
}

/**
 * Вид «Месяц»: сетка строк-недель с разной высотой. Строка с сегодняшним днём
 * (текущая неделя) — заметно выше. Прошедшие дни — серее и компактнее.
 * Drag задач между днями — через @dnd-kit.
 */
export function MonthView({ tasks, onSelectDay, onSelectWeek, onChange }: Props) {
  const selectedDate = useStore((s) => s.selectedDate);
  const monthDate = useStore((s) => s.monthDate);
  const setMonthDate = useStore((s) => s.setMonthDate);
  const mondayFirst = useStore((s) => s.mondayFirst);
  const colorSets = useStore((s) => s.colorSets);
  const sortMode = useStore((s) => s.sortMode);
  // Якорь месяца: фиксируем при первом открытии вида — выбор дня в «Дне»
  // не будет двигать месяц (см. store.ts monthDate).
  useEffect(() => {
    if (monthDate === null) setMonthDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [menuDay, setMenuDay] = useState<Date | null>(null);

  // Escape закрывает модалку добавления.
  useEffect(() => {
    if (!menuDay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuDay(null);
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
    // !someday: «Когда-нибудь» не дублируется в днях месяца (см. WeekView).
    sortTasksByMode(tasks.filter((t) => !t.someday && isSameDay(fromEpochDay(t.date), d)), sortMode);

  const weekdays = mondayFirst
    ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    : ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  const openDay = (d: Date) => {
    setMenuDay(null);
    onSelectDay(d);
  };

  // Доп. время задачи: «09:00–10:30» (длительность) и «выезд в 08:15» —
  // мелкими подписями справа от названия (в списке задач дня).
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const timeMetaOf = (t: Task): string[] => {
    const meta: string[] = [];
    if (t.timeMinutes != null && t.durationMinutes) {
      const end = (t.timeMinutes + t.durationMinutes) % (24 * 60);
      meta.push(`${fmt(t.timeMinutes)}–${fmt(end)}`);
    }
    if (t.timeMinutes != null && t.travelTime) {
      const dep = (t.timeMinutes - t.travelTime + 24 * 60) % (24 * 60);
      meta.push(`выезд в ${fmt(dep)}`);
    }
    return meta;
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
                    // Затемнять надо ячейки вне ОТОБРАЖАЕМОГО месяца (якорь
                    // monthDate), а не выбранной даты — иначе при рассинхроне
                    // якорей весь месяц выглядел бы «чужим».
                    inMonth={day.getMonth() === (monthDate ?? selectedDate).getMonth()}
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
          className="modal-overlay"
          onClick={() => setMenuDay(null)}
          style={{
            position: "fixed", inset: 0,
            background: "var(--overlay)", zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{
              background: COLORS.card,
              border: `1px solid var(--border-color)`,
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
                <div key={t.id} style={{ borderRadius: "var(--radius-sm)" }}>
                  <button
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
                      width: "100%",
                      minWidth: 0,
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
                    {/* Справа от задачи — время выполнения и выезд (если заданы):
                        карточка широкая, место для всей информации есть. */}
                    {timeMetaOf(t).length > 0 && (
                      <span
                        style={{
                          marginLeft: "auto",
                          flexShrink: 0,
                          fontSize: "var(--fs-2xs)",
                          color: COLORS.muted,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {timeMetaOf(t).join(" · ")}
                      </span>
                    )}
                  </button>
                  {/* Подзадачи задачи — компактным списком под строкой
                      (в месяце их раньше не было вовсе). */}
                  <DayTaskSubs taskId={t.id} done={t.isDone} />
                </div>
              ))}
            </div>

            {/* Форма добавления: название, время (системные часы + пресеты),
                приоритет, длительность, категория — общий компонент,
                как в дне/неделе (окно «Новая задача»). */}
            <TaskFormFields
              day={menuDay}
              onAdded={() => {
                setMenuDay(null);
                onChange();
              }}
              onCancel={() => setMenuDay(null)}
            />
            {/* Переход из месяца: в день или в неделю (с этим днём). */}
            <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)" }}>
              <button
                className="modal-action-btn primary"
                onClick={() => openDay(menuDay)}
                style={{ flex: 1 }}
              >
                К дню
              </button>
              <button
                className="modal-action-btn"
                onClick={() => {
                  setMenuDay(null);
                  onSelectWeek(menuDay);
                }}
                style={{ flex: 1 }}
              >
                К неделе
              </button>
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
  dayTasks,
  onClickDay,
}: {
  day: Date;
  inMonth: boolean;
  dayTasks: Task[];
  onClickDay: () => void;
}) {
  const isTd = isToday(day);
  const past = isPast(day);
  const ed = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const { setNodeRef, isOver } = useDroppable({ id: dayId(ed) });

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-label={day.toLocaleDateString("ru", { day: "numeric", month: "long" })}
      onClick={onClickDay}
      onKeyDown={(e) => {
        // Клавиатура: Enter/пробел открывают меню дня (как клик).
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClickDay();
        }
      }}
      style={{
        background: isOver
          ? accentTint(0.12)
          : COLORS.card,
        // Рамки и подсветки выбранного дня нет; «сегодня» — акцентная обводка.
        boxShadow: isTd
          ? `inset 0 0 0 1.5px ${COLORS.accent}`
          : "none",
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
      <CategoryBadges tasks={dayTasks} />
    </div>
  );
}

/** Плашки категорий дня: кружок цвета категории + число невыполненных задач
 *  этой категории. Задачи без категории (colorSetId null/«cs-none») — серая
 *  точка. Выполненные задачи не учитываются (плашка = «сколько ещё сделать»).
 *  Клик по дню открывает окно с полным списком задач (см. menuDay). */
function CategoryBadges({ tasks }: { tasks: Task[] }) {
  const colorSets = useStore((s) => s.colorSets);
  // Группируем невыполненные задачи по colorSetId; null/cs-none → «без цвета».
  const open = tasks.filter((t) => !t.isDone);
  if (open.length === 0) return null;
  const counts = new Map<string, number>();
  for (const t of open) {
    const key = !t.colorSetId || t.colorSetId === "cs-none" ? "" : t.colorSetId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // «Без цвета» — последним, чтобы цветные категории были видны первыми.
  const entries = [...counts.entries()].sort((a, b) => {
    if (a[0] === "") return 1;
    if (b[0] === "") return -1;
    return b[1] - a[1];
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px" }}>
      {entries.map(([key, n]) => {
        const hex = key === "" ? null : setHex(colorSets, key);
        return (
          <span
            key={key || "_none"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: "var(--fs-2xs)",
              color: COLORS.text,
              lineHeight: 1.2,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                flexShrink: 0,
                background: hex ?? COLORS.muted,
              }}
            />
            {n}
          </span>
        );
      })}
    </div>
  );
}

/** Подзадачи одной задачи в модалке дня (месяц). Раньше в месяце их не было
 *  вовсе — теперь компактный список под строкой задачи. Клик по подзадаче
 *  не нужен (переход к дню открывает карточку), поэтому без чекбоксов и drag. */
function DayTaskSubs({ taskId, done }: { taskId: string; done: boolean }) {
  const [subs, setSubs] = useState<Subtask[] | null>(null);
  useEffect(() => {
    let alive = true;
    setSubs(null);
    api
      .getSubtasks(taskId)
      .then((list) => {
        if (alive) setSubs(list);
      })
      .catch(() => {
        if (alive) setSubs([]); // ошибка — просто не показываем блок
      });
    return () => {
      alive = false;
    };
  }, [taskId]);
  if (!subs || subs.length === 0) return null;
  return (
    <div
      style={{
        margin: "0 var(--sp-3) var(--sp-1) calc(var(--sp-4) + 14px)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {subs.map((s) => (
        <span
          key={s.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            fontSize: "var(--fs-2xs)",
            color: s.isDone || done ? COLORS.muted : COLORS.text,
            textDecoration: s.isDone || done ? "line-through" : "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.muted, flexShrink: 0 }} />
          {s.title}
        </span>
      ))}
    </div>
  );
}
