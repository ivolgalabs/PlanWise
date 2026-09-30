import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { TaskCard } from "../components/TaskCard";
import { SomedayColumn } from "../components/SomedayColumn";
import { ArchivePanel } from "../components/ArchivePanel";
import { AddTaskModal } from "../components/AddTaskModal";
import { Icon } from "../components/Icon";
import { COLORS, accentTint } from "../theme";
import { dayId } from "../drag";
import { isToday, formatMinutes, toEpochDay, tasksForDay } from "../date";
import { useMediaQuery } from "../useMediaQuery";
import { useStore, type TaskPattern } from "../store";
import { showToast } from "../toast";
import { createTaskFromPattern } from "../api";
import { useI18n } from "../i18n";

interface Props {
  day: Date;
  tasks: Task[];
  /** Архивные задачи — нужны для доступа к архиву на мобильном. */
  archivedTasks: Task[];
  onChange: () => void;
}

/**
 * Вид «День»: слева — крупный заголовок + задачи, справа — мини-календарь.
 * Задачи можно перетаскивать на соседние дни через боковые drop-зоны
 * (◀ вчера / завтра ▶) и на любой день в мини-календаре.
 */
export function DayView({ day, tasks, archivedTasks, onChange }: Props) {
  const { t } = useI18n();
  const [newTitle, setNewTitle] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  // В совсем узком окне прячем и боковую зону «завтра».
  const tiny = useMediaQuery("(max-width: 560px)");
  // Правая панель (с мини-календарём и «Когда-нибудь») скрывается при
  // <700px — тот же порог, что в App (calNarrow). Секции «Когда-нибудь» и
  // «Архив» должны дублироваться внизу дня В ТОТ ЖЕ момент, иначе в полосе
  // 561–700px они становятся недоступны вовсе.
  const panelNarrow = useMediaQuery("(max-width: 700px)");

  const sortMode = useStore((s) => s.sortMode);
  const dayTasks = tasksForDay(tasks, day, sortMode);

  const epochDay = toEpochDay(day);
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      await api.upsertTask({ title, date: epochDay });
      setNewTitle("");
    } catch (e) {
      // Текст не стираем — после сбоя можно повторить сохранение.
      showToast(t("err.saveTask", { error: String(e) }));
    }
    onChange();
    requestAnimationFrame(() => newInputRef.current?.focus());
  };

  const createNext = async (afterId: string) => {
    const after = dayTasks.find((t) => t.id === afterId);
    const sort = after ? after.sortOrder + 1 : Date.now();
    try {
      await api.upsertTask({ title: "", date: epochDay, sortOrder: sort });
    } catch (e) {
      showToast(t("err.createTask", { error: String(e) }));
      return;
    }
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
        allTasks={tasks}
        archivedTasks={archivedTasks}
        panelNarrow={panelNarrow}
        onChange={onChange}
        createNext={createNext}
        newTitle={newTitle}
        setNewTitle={setNewTitle}
        addTask={addTask}
        newInputRef={newInputRef}
      />
      {/* Боковая зона «завтра» — перенос задачи/подзадачи на завтра;
          в узком окне (tiny) скрыта, чтобы не красть ширину у задач */}
      {!tiny && <SideDayZone day={nextDay} label={t("day.tomorrow")} />}
    </div>
  );
}

/** Боковая узкая зона для переноса задачи на соседний день. */
function SideDayZone({ day, label }: { day: Date; label: string }) {
  const { t, lang } = useI18n();
  const ed = toEpochDay(day);
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
        border: `1px dashed ${isOver ? COLORS.accent : "var(--border-color)"}`,
        borderRadius: "var(--radius-md)",
        margin: "var(--sp-2)",
        userSelect: "none",
      }}
      title={t("day.dragToDate", { date: day.toLocaleDateString(lang, { day: "numeric", month: "long" }) })}
    >
      {label}
    </div>
  );
}

/** Основная колонка задач дня (не droppable — дни в DayView обслуживает календарь). */
function DayTasksArea({
  day,
  dayTasks,
  allTasks,
  archivedTasks,
  panelNarrow,
  onChange,
  createNext,
  newTitle,
  setNewTitle,
  addTask,
  newInputRef,
}: {
  day: Date;
  dayTasks: Task[];
  allTasks: Task[];
  archivedTasks: Task[];
  panelNarrow: boolean;
  onChange: () => void;
  createNext: (afterId: string) => void;
  newTitle: string;
  setNewTitle: (v: string) => void;
  addTask: () => void;
  newInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t, lang } = useI18n();
  // В DayView droppable-дни на десктопе обслуживает MiniCalendar (ячейки)
  // и SideDayZone (завтра). Но на узких экранах (panelNarrow) календарь скрыт —
  // поэтому здесь включаем droppable для dayId(epochDay) только при panelNarrow.
  const epochDay = toEpochDay(day);
  const { setNodeRef, isOver } = useDroppable({
    id: dayId(epochDay),
    disabled: !panelNarrow,
  });
  const today = isToday(day);
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  // На мобильном правая панель скрыта — «Когда-нибудь» и «Архив» показываем
  // здесь, внизу дня (раскрытие архива — по кнопке, чтобы не раздувать день).
  const visibility = useStore((s) => s.visibility);
  const taskPatterns = useStore((s) => s.taskPatterns);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Расширенное окно добавления: время, приоритет, длительность, категория.
  const [addOpen, setAddOpen] = useState(false);
  // Шаблон задач: кнопка создаёт задачу на этот день с параметрами шаблона.
  const addPattern = async (p: TaskPattern) => {
    await createTaskFromPattern(p, toEpochDay(day));
    onChange();
  };
  return (
    <div
      ref={panelNarrow ? setNodeRef : undefined}
      data-day-key={dayKey}
      style={{
        flex: 1,
        minHeight: 0,
        padding: "var(--sp-6) var(--sp-8)",
        overflowY: "auto",
        minWidth: 0,
        background: isOver ? accentTint(0.08) : undefined,
        // Тонкая акцентная полоса слева для текущего дня.
        boxShadow: today ? `inset 3px 0 0 ${COLORS.accent}` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", margin: "0 0 var(--sp-6)" }}>
        <h2
          style={{
            fontSize: "var(--fs-xl)",
            fontWeight: 700,
            color: today ? "var(--accent-text)" : COLORS.text,
            margin: 0,
            textTransform: "capitalize",
          }}
        >
          {day.toLocaleDateString(lang, {
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
            {t("day.noTasks")}
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

      {/* Inline-поле ввода — крупное. Форма: кнопка «Далее/Готово» мобильной
          клавиатуры (enterKeyHint) добавляет задачу, как Enter на десктопе.
          Рядом — «Настроить»: расширенное окно (время, приоритет, категория).
          Ряд отделён от задач полной линией сверху (на ряду, а не на input —
          чтобы линия шла и под шестерёнкой, и кнопка не наезжала на задачи). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          borderTop: "1px solid var(--border-color)",
          marginTop: "var(--sp-3)",
          paddingTop: "var(--sp-3)",
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
            ref={newInputRef}
            className="inline-input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            enterKeyHint="done"
            placeholder={t("day.addTaskPh")}
            style={{
              width: "100%",
              border: "none",
              padding: "var(--sp-2) var(--sp-1)",
              fontSize: "var(--fs-md)",
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

      {/* Быстрые шаблоны задач (настраиваются в настройках) — кнопка создаёт
          задачу с готовыми временем/сложностью/длительностью. */}
      {taskPatterns.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", padding: "var(--sp-1) var(--sp-2)" }}>
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

      {/* Мобильный доступ к «Когда-нибудь» и «Архиву»: правая панель на узком
          экране скрыта (panelNarrow = тот же порог, что в App), поэтому
          секции дублируются здесь, внизу дня. «Когда-нибудь» — по настройке
          видимости. */}
      {panelNarrow && (
        <div style={{ marginTop: "var(--sp-6)" }}>
          {visibility.someday && (
            <SomedayColumn
              tasks={allTasks.filter((t) => t.someday)}
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
        </div>
      )}
    </div>
  );
}
