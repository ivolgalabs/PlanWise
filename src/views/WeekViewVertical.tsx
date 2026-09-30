import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { weekDays, isToday, isPast, dayWeight, formatMinutes, toEpochDay, tasksForDay } from "../date";
import { TaskCard } from "../components/TaskCard";
import { WeekShiftZone } from "../components/WeekShiftZone";
import { SomedayColumn } from "../components/SomedayColumn";
import { ArchivePanel } from "../components/ArchivePanel";
import { AddTaskModal } from "../components/AddTaskModal";
import { Icon } from "../components/Icon";
import { COLORS, accentTint } from "../theme";
import { useStore, type TaskPattern } from "../store";
import { createTaskFromPattern } from "../api";
import { dayId } from "../drag";
import { showToast } from "../toast";
import { useI18n } from "../i18n";

interface Props {
  tasks: Task[];
  /** Архивные задачи — на мобильном правая панель скрыта, архив открывается
   *  кнопкой внизу недели (как в «Дне»). */
  archivedTasks: Task[];
  /** Правая панель скрыта (тот же порог, что в App — 1000px для недели):
   *  «Когда-нибудь» и «Архив» дублируются внизу. Отдельный флаг от narrow,
   *  чтобы в полосе 821–1000px секции не пропадали, а сетка/список недели
   *  переключались по-прежнему на 820px. */
  mobileSections?: boolean;
  /** Якорь недели (weekDate ?? selectedDate) — тот же, что у сетки недели,
   *  иначе список и сетка показывали бы разные недели после выбора дня. */
  anchor?: Date;
  onChange: () => void;
}

/**
 * Вид «Неделя» (вертикальный): дни сверху вниз, с inline-полем ввода
 * в каждом дне и расширяемыми строками. Каждый день — droppable-зона
 * для перетаскивания задач (@dnd-kit).
 */
export function WeekViewVertical({ tasks, archivedTasks, mobileSections, anchor, onChange }: Props) {
  const { t } = useI18n();
  const selectedDate = useStore((s) => s.selectedDate);
  const mondayFirst = useStore((s) => s.mondayFirst);
  const visibility = useStore((s) => s.visibility);
  const sortMode = useStore((s) => s.sortMode);
  const [titlesByDay, setTitlesByDay] = useState<Record<string, string>>({});
  const days = weekDays(anchor ?? selectedDate, mondayFirst);
  // Раскрытие архива — по кнопке (как в «Дне»), чтобы не раздувать список.
  const [archiveOpen, setArchiveOpen] = useState(false);

  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const addTask = async (d: Date) => {
    const title = (titlesByDay[dayKey(d)] ?? "").trim();
    if (!title) return;
    try {
      await api.upsertTask({ title, date: toEpochDay(d) });
      setTitlesByDay((m) => ({ ...m, [dayKey(d)]: "" }));
    } catch (e) {
      showToast(t("err.saveTask", { error: String(e) }));
    }
    onChange();
  };

  const createNext = async (afterId: string, day: Date) => {
    const dayTasks = tasksForDay(tasks, day, sortMode);
    const after = dayTasks.find((t) => t.id === afterId);
    const sort = after ? after.sortOrder + 1 : Date.now();
    try {
      await api.upsertTask({ title: "", date: toEpochDay(day), sortOrder: sort });
    } catch (e) {
      showToast(t("err.createTask", { error: String(e) }));
      return;
    }
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
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Зона «следующая неделя» — только справа; перенос в прошлую неделю
          убран по желанию пользователя. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--sp-4)",
        }}
      >
        {days.map((d) => (
          <DayRow
            key={d.toISOString()}
            day={d}
            dayKey={dayKey(d)}
            dayTasks={tasksForDay(tasks, d, sortMode)}
            onChange={onChange}
            createNext={createNext}
            title={titlesByDay[dayKey(d)] ?? ""}
            setTitle={(v) =>
              setTitlesByDay((m) => ({ ...m, [dayKey(d)]: v }))
            }
            addTask={() => addTask(d)}
          />
        ))}
        {/* Мобильный доступ к «Когда-нибудь» и «Архиву»: правая панель скрыта
            (mobileSections = тот же порог, что в App), поэтому секции
            дублируются внизу недели (как в «Дне»). «Когда-нибудь» — по
            настройке видимости. */}
        {mobileSections && (
          <>
            {visibility.someday && (
              <SomedayColumn
                tasks={tasks.filter((t) => t.someday)}
                onChange={onChange}
                stretch
              />
            )}
            {archiveOpen ? (
              <ArchivePanel
                tasks={archivedTasks}
                onClose={() => setArchiveOpen(false)}
                onChange={onChange}
              />
            ) : (
              <button
                className="text-chip"
                onClick={() => setArchiveOpen(true)}
                style={{ margin: "var(--sp-3) var(--sp-1)" }}
                title={t("task.archiveTitle")}
              >
                {t("task.archiveCount", { n: archivedTasks.length })}
              </button>
            )}
          </>
        )}
      </div>
      <WeekShiftZone />
    </div>
  );
}

/** Один день-строка: droppable-зона + задачи + inline-поле ввода. */
function DayRow({
  day,
  dayKey,
  dayTasks,
  onChange,
  createNext,
  title,
  setTitle,
  addTask,
}: {
  day: Date;
  dayKey: string;
  dayTasks: Task[];
  onChange: () => void;
  createNext: (afterId: string, day: Date) => void;
  title: string;
  setTitle: (v: string) => void;
  addTask: () => void;
}) {
  const { t, lang } = useI18n();
  const today = isToday(day);
  const past = isPast(day);
  const weight = dayWeight(day);
  const ed = toEpochDay(day);
  const { setNodeRef, isOver } = useDroppable({ id: dayId(ed) });
  const taskPatterns = useStore((s) => s.taskPatterns);
  const weekday = day.toLocaleDateString(lang, { weekday: "short" });
  // Расширенное окно добавления задачи на этот день.
  const [addOpen, setAddOpen] = useState(false);

  // Шаблон задач: кнопка создаёт задачу на этот день с параметрами шаблона.
  const addPattern = async (p: TaskPattern) => {
    await createTaskFromPattern(p, ed);
    onChange();
  };

  // Иерархия: past — бледный/компактный, today/tomorrow — крупные, остальные
  // (ближние и дальние будущие) — одинаково нормальные: иначе пятница
  // (за +2..3 дня) была яркой, а суббота (за +4) вдруг серой — без видимой
  // причины для пользователя.
  const dim = weight === "past" ? 0.4 : 1;
  const headFs =
    weight === "past"
      ? "var(--fs-2xs)"
      : weight === "today" || weight === "tomorrow"
        ? "var(--fs-md)"
        : "var(--fs-sm)";
  const headWeight =
    weight === "past" ? 400 : weight === "today" || weight === "tomorrow" ? 700 : 600;
  const headColor =
    weight === "today"
      ? "var(--accent-text)"
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
          : "transparent",
        // Рамки и подсветки выбранного дня нет — только «сегодня» ● в заголовке.
        border: "none",
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
          // Иерархия: прошедшие дни — мельче шрифт задач (fs-sm), остальные —
          // обычный (fs-md). Мелкие задачи (fs-2xs) нечитаемы при окне 1100px.
          fontSize: weight === "past" ? "var(--fs-sm)" : "var(--fs-md)",
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
        {/* Inline-поле ввода новой задачи. Форма: «Далее/Готово» на мобильной
            клавиатуре добавляет задачу, как Enter на десктопе. Рядом —
            «Настроить»: расширенное окно (время, приоритет, категория). */}
        {/* Ряд «+ добавить»: отделён от задач ПОЛНОЙ линией сверху — граница
            на ряду, а не на input (раньше линия была только под полем, и
            шестерёнка «наезжала» на заголовок дня/последнюю задачу). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-1)",
            borderTop: "1px solid var(--border-color)",
            marginTop: "var(--sp-2)",
            paddingTop: "var(--sp-2)",
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTask();
            }}
            style={{ flex: 1, minWidth: 0 }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              enterKeyHint="done"
              placeholder={t("day.addPh")}
              className="inline-input"
              style={{
                width: "100%",
                border: "none",
                padding: "var(--sp-1) var(--sp-1)",
                fontSize: "var(--fs-sm)",
                background: "transparent",
                outline: "none",
                color: COLORS.text,
              }}
            />
          </form>
          <button
            className="chip-btn-sm"
            onClick={() => setAddOpen(true)}
            title={t("task.configure")}
            style={{ flexShrink: 0 }}
          >
            <Icon name="gear" size={12} />
          </button>
        </div>
        {addOpen && (
          <AddTaskModal
            day={day}
            onChange={onChange}
            onClose={() => setAddOpen(false)}
          />
        )}
          {/* Быстрые шаблоны задач — кнопка создаёт задачу на этот день. */}
          {taskPatterns.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", padding: "var(--sp-1) var(--sp-1) 0" }}>
              <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, alignSelf: "center" }}>
                {t("task.template")}
              </span>
              {taskPatterns.map((p) => (
                <button
                  key={p.id}
                  className="text-chip"
                  onClick={() => addPattern(p)}
                  title={
                    p.timeMinutes != null
                      ? `${formatMinutes(p.timeMinutes)} · ${p.durationMinutes ? t("unit.minutesN", { n: p.durationMinutes }) : t("unit.noDuration")}`
                      : t("task.withinDay")
                  }
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}
