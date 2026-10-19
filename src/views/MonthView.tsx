import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task, Subtask, ColorSet } from "../api";
import { api } from "../api";
import { startOfWeek, firstOfMonth, isSameMonth, isToday, isPast, toEpochDay, fromEpochDay, tasksForDay, hasTimeConflict, taskTimeRange, travelTimeText } from "../date";
import { COLORS, accentTint, setHex } from "../theme";
import { useStore } from "../store";
import { useMediaQuery } from "../useMediaQuery";
import { dayId } from "../drag";
import { useSubtasks } from "../useSubtasks";
import { TaskFormFields } from "../components/AddTaskModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useI18n } from "../i18n";

interface Props {
  tasks: Task[];
  onSelectDay: (d: Date) => void;
  /** Перейти к неделе с этим днём (кнопка «К неделе» в окне дня). */
  onSelectWeek: (d: Date) => void;
  onChange: () => void;
}

/** Время задачи: «09:00–10:30» (диапазон при длительности) и «выезд в 08:15».
 *  Диапазон показывается бейджем как единственное время задачи — стартовое
 *  время в нём уже есть, отдельно не дублируется. */

/**
 * Вид «Месяц»: сетка строк-недель с разной высотой. Строка с сегодняшним днём
 * (текущая неделя) — заметно выше. Прошедшие дни — серее и компактнее.
 * Drag задач между днями — через @dnd-kit.
 */
export function MonthView({ tasks, onSelectDay, onSelectWeek, onChange }: Props) {
  const { t, lang } = useI18n();
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
  // Задача на подтверждение удаления (модалка «Удалить задачу?»).
  const [confirmDel, setConfirmDel] = useState<Task | null>(null);
  // Широкий экран: меню дня разбивается на две колонки — список задач слева
  // (свой скролл), форма добавления справа (всегда на виду).
  const wide = useMediaQuery("(min-width: 760px)");

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

  // Короткие имена дней недели — из Intl по текущему языку (порядок: от начала
  // недели; 2024-01-01 — понедельник как точка отсчёта Пн…Вс).
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang, { weekday: "short" });
    const base = new Date(2024, 0, 1);
    const monFirst = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const s = fmt.format(d);
      return s.charAt(0).toUpperCase() + s.slice(1);
    });
    return mondayFirst ? monFirst : [monFirst[6]!, ...monFirst.slice(0, 6)];
  }, [lang, mondayFirst]);

  // Сводка видимого месяца: сделано / отпущено / застряло (↻3) и сделанное по категориям.
  const summary = useMemo(() => {
    const anchor = monthDate ?? selectedDate;
    let done = 0;
    let dropped = 0;
    let stuck = 0;
    const byCat = new Map<string, number>();
    for (const x of tasks) {
      if (x.someday || x.archived || !isSameMonth(fromEpochDay(x.date), anchor)) continue;
      if (x.droppedAt) dropped++;
      else if (x.isDone) {
        done++;
        const k = !x.colorSetId || x.colorSetId === "cs-none" ? "" : x.colorSetId;
        byCat.set(k, (byCat.get(k) ?? 0) + 1);
      } else if ((x.postponeCount ?? 0) >= 3) stuck++;
    }
    return { done, dropped, stuck, byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]) };
  }, [tasks, monthDate, selectedDate]);

  const openDay = (d: Date) => {
    setMenuDay(null);
    onSelectDay(d);
  };

  // Список задач дня — общий для широкой и узкой раскладок панели.
  const dayList = menuDay ? tasksForDay(tasks, menuDay, sortMode) : [];
  const taskList = menuDay ? (
    <>
      {dayList.length === 0 && (
        <p style={{ margin: 0, padding: "var(--sp-1) 0", fontSize: "var(--fs-sm)", color: COLORS.muted }}>
          {t("month.noTasks")}
        </p>
      )}
      {dayList.map((t) => (
        <div key={t.id} className="month-task-block" style={{ borderRadius: "var(--radius-sm)", minWidth: 0 }}>
          {/* Строка задачи: клик по свободному месту — к дню, по тексту —
              инлайн-переименование, ✕ — удаление с подтверждением. */}
          <MonthTaskRow
            task={t}
            colorSets={colorSets}
            conflict={hasTimeConflict(t, dayList)}
            onOpenDay={() => openDay(menuDay)}
            onRename={async (title) => {
              await api.upsertTask({ ...t, title });
              onChange();
            }}
            onDelete={() => setConfirmDel(t)}
          />
          {/* Подзадачи задачи — компактным списком под строкой
              (в месяце их раньше не было вовсе). */}
          <DayTaskSubs taskId={t.id} done={t.isDone} />
        </div>
      ))}
    </>
  ) : null;

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "var(--sp-4)" }}>
      {summary.done + summary.dropped + summary.stuck > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "var(--sp-1) var(--sp-4)",
            padding: "0 var(--sp-2) var(--sp-2)",
            fontSize: "var(--fs-sm)",
            color: COLORS.muted,
          }}
        >
          <span>{t("month.done")} <b style={{ color: COLORS.text }}>{summary.done}</b></span>
          <span>{t("month.dropped")} <b style={{ color: COLORS.text }}>{summary.dropped}</b></span>
          {summary.stuck > 0 && (
            <span style={{ color: "var(--danger)" }}>{t("month.stuck")} <b>{summary.stuck}</b></span>
          )}
          {summary.byCat.map(([key, n]) => (
            <span key={key || "_none"} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: key === "" ? COLORS.muted : (setHex(colorSets, key) ?? COLORS.muted),
                }}
              />
              {n}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex" }}>
        {weekdays.map((w, i) => (
          <div
            key={i}
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
                    inMonth={isSameMonth(day, monthDate ?? selectedDate)}
                    dayTasks={tasksForDay(tasks, day, sortMode)}
                    showTitles={wide}
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
          style={{ zIndex: 200 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{
              background: COLORS.card,
              border: `1px solid var(--border-color)`,
              borderRadius: "var(--radius-md)",
              // Панель во всю высоту экрана: список задач скроллится внутри,
              // форма добавления и переходы всегда на виду (раньше при длинном
              // списке до них нужно было прокручивать всю панель).
              padding: "var(--sp-8)",
              width: wide ? 720 : 460,
              maxWidth: "92vw",
              height: "min(85vh, 720px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <div style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: COLORS.text, marginBottom: "var(--sp-5)", textTransform: "capitalize", flexShrink: 0 }}>
              {menuDay.toLocaleDateString(lang, { day: "numeric", month: "long", weekday: "long" })}
            </div>

            {wide ? (
              /* Широкий экран: список задач слева (свой скролл), форма и
                 переходы справа — видны одновременно. */
              <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "var(--sp-6)", overflow: "hidden" }}>
                <div style={{ minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)", paddingRight: "var(--sp-2)" }}>
                  {taskList}
                </div>
                <div style={{ minHeight: 0, overflowY: "auto" }}>
                  {/* Форма добавления: название, время (системные часы +
                      пресеты), приоритет, длительность, категория — общий
                      компонент, как в дне/неделе (окно «Новая задача»). */}
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
                      {t("month.toDay")}
                    </button>
                    <button
                      className="modal-action-btn"
                      onClick={() => {
                        setMenuDay(null);
                        onSelectWeek(menuDay);
                      }}
                      style={{ flex: 1 }}
                    >
                      {t("month.toWeek")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Узкий экран: список со своим скроллом над формой — форма
                 доступна без прокрутки всего списка. */
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  {taskList}
                </div>
                <div style={{ flexShrink: 0, maxHeight: "45%", overflowY: "auto" }}>
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
                      {t("month.toDay")}
                    </button>
                    <button
                      className="modal-action-btn"
                      onClick={() => {
                        setMenuDay(null);
                        onSelectWeek(menuDay);
                      }}
                      style={{ flex: 1 }}
                    >
                      {t("month.toWeek")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Подтверждение удаления задачи (как в карточке задачи). */}
      {confirmDel && (
        <ConfirmDialog
          title={t("form.confirmDelete", { title: confirmDel.title.trim() || t("common.unnamed") })}
          confirmLabel={t("common.delete")}
          onConfirm={async () => {
            const task = confirmDel;
            setConfirmDel(null);
            await api.deleteTask(task.id);
            onChange();
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
    </>
  );
}

/** Ячейка дня месяца — droppable-зона для задач. */
function MonthCell({
  day,
  inMonth,
  dayTasks,
  showTitles,
  onClickDay,
}: {
  day: Date;
  inMonth: boolean;
  dayTasks: Task[];
  /** Широкий экран: под плашками — названия первых двух открытых задач. */
  showTitles: boolean;
  onClickDay: () => void;
}) {
  const { lang } = useI18n();
  const isTd = isToday(day);
  const past = isPast(day);
  const ed = toEpochDay(day);
  const { setNodeRef, isOver } = useDroppable({ id: dayId(ed) });

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-label={day.toLocaleDateString(lang, { day: "numeric", month: "long" })}
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
      {showTitles &&
        dayTasks
          .filter((x) => !x.isDone)
          .slice(0, 2)
          .map((x) => (
            <div
              key={x.id}
              style={{
                fontSize: "var(--fs-2xs)",
                color: COLORS.text,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {x.title}
            </div>
          ))}
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

/** Строка задачи в модалке дня (месяц). Клик по свободному месту — переход
 *  к дню; клик по тексту — инлайн-переименование (как в дне/неделе);
 *  ✕ справа — удаление задачи (подтверждается отдельным диалогом).
 *  Вся цепочка вложенности с minWidth: 0/overflow: hidden — длинные названия
 *  и подписи времени не должны выталкивать строку за края карточки. */
function MonthTaskRow({
  task,
  colorSets,
  conflict,
  onOpenDay,
  onRename,
  onDelete,
}: {
  task: Task;
  colorSets: ColorSet[];
  /** Время пересекается с другой задачей этого дня (красный бейдж). */
  conflict: boolean;
  onOpenDay: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  const commit = async () => {
    const nextTitle = value.trim();
    setEditing(false);
    if (nextTitle && nextTitle !== task.title) await onRename(nextTitle);
  };

  // Время: при длительности показываем ТОЛЬКО диапазон «09:00–10:30» (бейдж),
  // стартовое время не дублируем — оно уже есть в диапазоне. Без длительности —
  // просто «09:00». Конфликт — красный бейдж, как время в дне/неделе.
  const hasTime = task.timeMinutes != null;
  const hasRange = hasTime && !!task.durationMinutes;
  const timeText = taskTimeRange(task);
  const travel = travelTimeText(task);
  const timeBadge = hasTime ? (
    <span
      className={`task-time has${conflict ? " conflict" : ""}`}
      title={conflict ? t("task.timeConflict") : undefined}
    >
      {timeText}
    </span>
  ) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDay}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDay();
        }
      }}
      className="month-task-btn"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        textAlign: "left",
        // Вертикальный отступ больше прежнего: строки не слипаются, кнопки
        // удаления не наслаиваются друг на друга.
        padding: "var(--sp-3) var(--sp-3)",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        fontSize: "var(--fs-sm)",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        color: task.isDone ? COLORS.muted : COLORS.text,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background:
            task.isDone || !task.colorSetId
              ? COLORS.muted
              : setHex(colorSets, task.colorSetId) ?? COLORS.muted,
        }}
      />
      {/* Бейдж стартового времени — только без диапазона: при длительности
          время уже показано диапазоном справа, дублировать не нужно. */}
      {hasTime && !hasRange && timeBadge}
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // Enter/Escape/Space не должны уходить на строку (открытие дня)
          // и на окно (закрытие модалки) — останавливаем всплытие.
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          data-month-task-edit-id={task.id}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--fs-sm)",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--accent)",
            outline: "none",
            color: task.isDone ? COLORS.muted : COLORS.text,
          }}
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setValue(task.title);
            setEditing(true);
          }}
          title={task.title || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            // Длинное название ПЕРЕНОСИТСЯ на новые строки, а не режется
            // многоточием: раньше хвост задачи был не виден. Список дня
            // скроллится, поэтому высота строки не ограничена.
            whiteSpace: "normal",
            wordBreak: "break-word",
            cursor: "text",
            textDecoration: task.isDone ? "line-through" : "none",
          }}
        >
          {task.title}
        </span>
      )}
      {/* Справа: диапазон времени (бейдж, красный при конфликте) и выезд.
          flexWrap: блок переносится, а не наезжает на кнопку удаления. */}
      {(hasRange && timeBadge) || travel ? (
        <span
          style={{
            marginLeft: "auto",
            flexShrink: 1,
            minWidth: 0,
            maxWidth: "60%",
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "var(--sp-2)",
          }}
        >
          {hasRange && timeBadge}
          {travel && (
            <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, whiteSpace: "nowrap" }}>
              {travel}
            </span>
          )}
        </span>
      ) : null}
      <button
        type="button"
        className="chip-btn-sm"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t("form.deleteTaskTitle")}
        style={{ flexShrink: 0 }}
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}

/** Подзадачи одной задачи в модалке дня (месяц). Раньше в месяце их не было
 *  вовсе — теперь компактный список под строкой задачи. Без чекбоксов и drag:
 *  клик по тексту — инлайн-переименование, ✕ — удаление. */
function DayTaskSubs({ taskId, done }: { taskId: string; done: boolean }) {
  // Версия списка: после переименования/удаления бампаем — хук перечитает.
  const [rev, setRev] = useState(0);
  const { items: subs } = useSubtasks(taskId, rev);
  if (subs.length === 0) return null;
  return (
    <div
      style={{
        margin: "0 var(--sp-3) var(--sp-2) calc(var(--sp-4) + 14px)",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
      }}
    >
      {subs.map((s) => (
        <MonthSubRow key={s.id} sub={s} done={done} onChanged={() => setRev((v) => v + 1)} />
      ))}
    </div>
  );
}

/** Строка подзадачи в модалке дня (месяц): точка + текст (клик — инлайн-
 *  переименование) + ✕ (удаление). minWidth: 0/overflow: hidden — длинный
 *  текст подзадачи обрезается многоточием, а не выходит за края карточки. */
function MonthSubRow({
  sub,
  done,
  onChanged,
}: {
  sub: Subtask;
  done: boolean;
  /** Перечитать список подзадач после переименования/удаления. */
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sub.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  const commit = () => {
    const nextTitle = value.trim();
    setEditing(false);
    if (nextTitle && nextTitle !== sub.title) {
      api.upsertSubtask({ ...sub, title: nextTitle }).then(onChanged);
    }
  };

  const done2 = sub.isDone || done;
  return (
    <div
      className="subtask-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        fontSize: "var(--fs-2xs)",
        minWidth: 0,
        // Немного вертикального воздуха — строки подзадач не слипаются.
        padding: "var(--sp-1) 0",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: COLORS.muted,
          flexShrink: 0,
        }}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          onBlur={commit}
          data-subtask-edit-id={sub.id}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--fs-2xs)",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--accent)",
            outline: "none",
            color: done2 ? COLORS.muted : COLORS.text,
            textDecoration: done2 ? "line-through" : "none",
          }}
        />
      ) : (
        <span
          onClick={() => {
            setValue(sub.title);
            setEditing(true);
          }}
          title={sub.title || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            // Длинный текст подзадачи переносится, а не обрезается.
            whiteSpace: "normal",
            wordBreak: "break-word",
            color: done2 ? COLORS.muted : COLORS.text,
            textDecoration: done2 ? "line-through" : "none",
            cursor: "text",
          }}
        >
          {sub.title}
        </span>
      )}
      <button
        type="button"
        className="chip-btn-sm"
        onClick={async () => {
          await api.deleteSubtask(sub.id);
          onChanged();
        }}
        title={t("month.deleteSubtask")}
        style={{ flexShrink: 0 }}
      >
        <Icon name="close" size={10} />
      </button>
    </div>
  );
}
