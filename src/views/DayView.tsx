import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { quickTask } from "../quickAdd";
import { TaskCard } from "../components/TaskCard";
import { CloseDayButton, OPEN_CLOSE_DAY, useUsualLoad, doneToday } from "../components/CloseDayDialog";
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
      await api.upsertTask(quickTask(title, epochDay, toEpochDay(new Date())));
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
  // Открытые задачи прошлых дней в колонке дня не видны — только в «Закрыть день».
  const doneN = today ? doneToday(allTasks, epochDay).length : 0;
  const tails = allTasks.filter((x) => !x.isDone && !x.someday && !x.archived && x.date < epochDay).length;
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  // На мобильном правая панель скрыта — «Когда-нибудь» и «Архив» показываем
  // здесь, внизу дня (раскрытие архива — по кнопке, чтобы не раздувать день).
  const visibility = useStore((s) => s.visibility);
  const taskPatterns = useStore((s) => s.taskPatterns);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Расширенное окно добавления: время, приоритет, длительность, категория.
  const [addOpen, setAddOpen] = useState(false);
  // «Главное дня» — только у сегодняшнего дня и по настройке; статус и черта — всегда у сегодня.
  const usual = useUsualLoad(today);
  const focusOn = today && visibility.focus;
  const focus = focusOn ? dayTasks.filter((x) => x.difficulty === 3) : [];
  const rest = focusOn ? dayTasks.filter((x) => x.difficulty !== 3) : dayTasks;
  const focusDone = focus.filter((x) => x.isDone).length;
  const [askHidden, setAskHidden] = useState(false);
  // Подсказка «что главное»: застрявшие и задачи со временем — первыми.
  const suggest = rest
    .filter((x) => !x.isDone)
    .sort((a, b) => (b.postponeCount ?? 0) - (a.postponeCount ?? 0) || (a.timeMinutes == null ? 1 : 0) - (b.timeMinutes == null ? 1 : 0))
    .slice(0, 3);
  const setFocus = async (x: Task) => {
    try {
      await api.upsertTask({ ...x, difficulty: 3 });
    } catch (e) {
      showToast(t("err.saveTask", { error: String(e) }));
    }
    onChange();
  };
  // Черта «обычно успеваете до сюда»: после usual-й задачи (главное считается), если задач больше.
  const lineAt = today && usual > 0 && dayTasks.length > usual ? Math.max(usual - focus.length, 0) : -1;
  const statusParts = [
    doneN > 0 && <span key="d" style={{ color: "var(--accent-text)" }}>{t("day.statDone", { n: doneN })}</span>,
    tails > 0 && (
      <button
        key="t"
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_CLOSE_DAY))}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textDecoration: "underline dotted" }}
      >
        {t("day.statTails", { n: tails })}
      </button>
    ),
    usual > 0 && dayTasks.length > 0 && <span key="u">{t("day.statLoad", { n: dayTasks.length, u: usual })}</span>,
  ].filter(Boolean);
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
        {today && <CloseDayButton onChange={onChange} />}
      </div>

      <div>
        {dayTasks.length === 0 && (
          <p style={{ color: COLORS.muted, fontSize: "var(--fs-base)" }}>
            {t("day.noTasks")}
          </p>
        )}
        {today && dayTasks.length > 0 && dayTasks.every((x) => x.isDone) && tails === 0 && (
          <p style={{ color: "var(--accent-text)", fontSize: "var(--fs-base)" }}>{t("day.allDone")}</p>
        )}
        {today && statusParts.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", fontSize: "var(--fs-sm)", color: "var(--text-secondary)", marginBottom: "var(--sp-3)" }}>
            {statusParts.map((p, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden="true">· </span>}
                {p}
              </span>
            ))}
          </div>
        )}
        {focus.length > 0 && (
          <div style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: accentTint(0.06), padding: "var(--sp-2) var(--sp-3)", marginBottom: "var(--sp-3)" }}>
            <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--accent-text)" }}>
              ★ {t("day.focusTitle", { done: focusDone, total: focus.length })}
              {focus.length > 3 && <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}> · {t("day.focusMany", { n: focus.length })}</span>}
            </div>
            {focus.map((x) => (
              <TaskCard key={x.id} task={x} onChange={onChange} onCreateNext={createNext} />
            ))}
            {focusDone === focus.length && (
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--accent-text)" }}>{t("day.focusDone")}</div>
            )}
          </div>
        )}
        {focusOn && focus.length === 0 && !askHidden && suggest.length > 0 && (
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
              <span>★ {t("day.focusAsk")}</span>
              <button type="button" className="text-chip" onClick={() => setAskHidden(true)}>{t("day.focusLater")}</button>
            </div>
            <div className="chip-group" style={{ marginTop: "var(--sp-2)" }}>
              {suggest.map((x) => (
                <button key={x.id} type="button" className="text-chip" onClick={() => setFocus(x)}>
                  ☆ {x.title.length > 28 ? x.title.slice(0, 27) + "…" : x.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {rest.map((x, i) => (
          <div key={x.id}>
            {i === lineAt && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--text-secondary)", fontSize: "var(--fs-2xs)", margin: "var(--sp-2) 0" }}>
                <span style={{ flex: 1, borderTop: "1px dashed var(--border-color)" }} />
                {t("day.usualLine")}
                <span style={{ flex: 1, borderTop: "1px dashed var(--border-color)" }} />
              </div>
            )}
            <TaskCard task={x} onChange={onChange} onCreateNext={createNext} />
          </div>
        ))}
      </div>

      {/* Inline-поле ввода — крупное. Форма: кнопка «Далее/Готово» мобильной
          клавиатуры (enterKeyHint) добавляет задачу, как Enter на десктопе.
          Рядом — «Настроить»: расширенное окно (время, приоритет, категория).
          Ряд отделён от задач полной линией сверху (на ряду, а не на input —
          чтобы линия шла и под шестерёнкой, и кнопка не наезжала на задачи). */}
      <div
        className="add-row"
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
          className="chip-btn-sm add-row-gear"
          onMouseDown={(e) => e.preventDefault()}
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
