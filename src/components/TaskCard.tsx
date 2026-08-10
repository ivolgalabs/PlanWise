import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS, accentTint, argbToHex } from "../theme";
import { useStore } from "../store";
import { TimePicker } from "./TimePicker";
import { SubtaskList } from "./SubtaskList";
import { AddTaskModal } from "./AddTaskModal";
import { Icon } from "./Icon";
import { taskIdZone } from "../drag";

interface Props {
  task: Task;
  onChange: () => void;
  /** Создать новую пустую задачу сразу после этой (расширение по Enter). */
  onCreateNext?: (afterTaskId: string) => void;
  /** Показывать ли пикер времени. По умолчанию true; компактная сетка недели
   *  рендерит время в компактном виде (TimePicker compact). */
  showTime?: boolean;
  /** Компактный режим для узких колонок сетки недели: меньше накладные
   *  отступы ручки/полоски/чекбокса, чтобы влезало поле задачи (≥40px). */
  compact?: boolean;
}

/**
 * Строка задачи (tweek-style line): чекбокс + inline-текст + цветная полоска
 * слева. В строке ТОЛЬКО текст и время — все остальные настройки (приоритет,
 * категория, длительность, заметка, перенос, удаление, уведомление) собраны
 * в карточке задачи, которая открывается по нажатию на задачу. Заметка, если
 * есть, видна под текстом (настройка «Заметки»).
 * Перетаскивается через @dnd-kit (useDraggable) — drag за всю строку.
 */
export function TaskCard({ task, onChange, onCreateNext, showTime = true, compact = false }: Props) {
  const [title, setTitle] = useState(task.title);
  const [editing, editingSetter] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Авто-высота textarea: растёт по контенту, максимум ~4 строки (96px).
  const growTitle = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px";
  };
  // Защита от двойного save: Enter (onKeyDown) и следующий за ним blur
  // (onBlur) вызывают save дважды подряд — пропускаем повторный вызов.
  const savedRef = useRef<number>(0);
  const { colorSets, visibility, tasks: allTasks, autoDonePastTime } = useStore();
  // На тач-устройствах время и мета собираются под текстом (компактно),
  // на десктопе — в ряд с текстом.
  const [isTouch, setTouch] = useState(
    () => window.matchMedia("(pointer: coarse), (max-width: 560px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 560px)");
    const handler = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // Мобильный компактный ряд (только вне компактной сетки недели).
  const mobileRow = isTouch && !compact;

  // Перетаскивание задачи через dnd-kit. data.task читается в onDragEnd.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: task.id, data: { task } });
  // Задача — также droppable-зона: на неё можно бросить подзадачу (прикрепить).
  const { setNodeRef: setDropRef, isOver: isDropTarget } = useDroppable({
    id: taskIdZone(task.id),
  });
  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // Синхронизируем локальный title, если задача изменилась извне.
  useEffect(() => {
    if (!editing) setTitle(task.title);
  }, [task.title, editing]);

  // При изменении текста/открытии — подгоняем высоту textarea.
  useEffect(() => {
    if (textareaRef.current) growTitle(textareaRef.current);
  }, [title, compact]);

  const save = async (): Promise<Task> => {
    const t = title.trim();
    // Enter+blur дублируют вызов в течение <300мс — пропускаем повтор.
    const now = Date.now();
    if (now - savedRef.current < 300) return task;
    savedRef.current = now;
    // Авто-удаление при пустом тексте — ТОЛЬКО если задача изначально была
    // пустой (создана Enter-ом и забыта). Очистка заголовка у существующей
    // задачи (Ctrl+A + Delete + blur) не должна её удалять.
    if (!t) {
      if (!task.title) {
        try {
          const subs = await api.getSubtasks(task.id);
          if (subs.length === 0) {
            await api.deleteTask(task.id);
            onChange();
            return task;
          }
        } catch {
          /* не критично — оставим как есть */
        }
      }
      return task;
    }
    if (t !== task.title) {
      try {
        const updated = await api.upsertTask({ ...task, title: t });
        onChange();
        return updated;
      } catch {
        return task; // время не меняется — конфликт невозможен; тихо
      }
    }
    return task;
  };

  const toggleDone = async () => {
    await api.upsertTask({ ...task, isDone: !task.isDone });
    onChange();
  };

  const setEditing = (v: boolean) => editingSetter(v);

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing && // игнорируем Enter во время IME-композиции
      (e.currentTarget.tagName !== "TEXTAREA" || !e.shiftKey)
    ) {
      e.preventDefault();
      const saved = await save();
      setEditing(false);
      // Создаём новую строку ниже и переводим на неё фокус.
      onCreateNext?.(saved.id);
    } else if (e.key === "Escape") {
      setTitle(task.title);
      setEditing(false);
    } else if (
      e.key === "Backspace" &&
      title === "" &&
      !task.title // удаляем только если задача была пустой
    ) {
      e.preventDefault();
      // Удаление пустой строки: раньше удаляли задачу; теперь строка без
      // текста просто очищается (удаление — в карточке задачи).
      if (!task.title) {
        try {
          const subs = await api.getSubtasks(task.id);
          if (subs.length === 0) {
            await api.deleteTask(task.id);
            onChange();
          }
        } catch {
          /* не критично */
        }
      }
    }
  };

  // Цвет категории задачи (линия слева на весь блок).
  const taskSet = colorSets.find((s) => s.id === task.colorSetId);
  const setHex = taskSet ? argbToHex(taskSet.color) : undefined;

  // Время показываем, только если его запросил родитель И настройка
  // «Время задач» включена.
  const effectiveShowTime = showTime && visibility.taskTime;

  // ── Пересечения по времени ────────────────────────────────────────
  // Задача «занимает» интервал [start, start+duration); без длительности —
  // одну минуту (мгновение). Одинаковое время двух задач = наложение.
  const intervalsOverlap = (m1: number, d1: number, m2: number, d2: number) =>
    m1 < m2 + Math.max(d2, 1) && m2 < m1 + Math.max(d1, 1);
  /** Другая задача того же дня, пересекающаяся с временем m (или undefined).
   *  dur — длительность для проверки (по умолчанию — текущая у задачи). */
  const findOverlap = (m: number | null, dur?: number | null): Task | undefined => {
    if (m == null) return undefined;
    const d1 = dur ?? task.durationMinutes ?? 0;
    return allTasks.find(
      (t) =>
        t.id !== task.id &&
        !t.isDone &&
        !t.archived &&
        !t.someday &&
        t.date === task.date &&
        t.timeMinutes != null &&
        intervalsOverlap(m, d1, t.timeMinutes, t.durationMinutes ?? 0),
    );
  };
  // Наложение: задача, чьё время пересекается с другой (видны и старые
  // конфликты, независимо от настройки «запрещать наложения»). Подсветка —
  // цветной фон строки и красное время, чтобы наложение было заметно.
  const timeConflict =
    task.timeMinutes != null && !task.isDone && findOverlap(task.timeMinutes) !== undefined;
  // Диалог «время занято»: Rust-команда вернула ошибку, показываем
  // конфликтующую задачу и предлагаем добавить текущую как подзадачу.
  const [conflictDlg, setConflictDlg] = useState<{ task: Task; time: number } | null>(null);
  // Карточка задачи (окно с полными настройками) — открывается по нажатию
  // на задачу (текст/строку); у пустой строки-заглушки тап по-прежнему
  // просто ставит курсор (быстрое добавление текстом).
  const [cardOpen, setCardOpen] = useState(false);
  const openCard = () => {
    if (task.title.trim()) setCardOpen(true);
  };

  const setTime = async (m: number | null) => {
    try {
      await api.upsertTask({ ...task, timeMinutes: m });
      // Авто-выполнение: время в прошлом → задача выполнена; в будущем —
      // выполнение снимается. Только при установке времени (настройка).
      if (autoDonePastTime && m != null) {
        const now = new Date();
        const today = Math.floor(
          Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
        );
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const past = task.date < today || (task.date === today && m <= nowMin);
        const future = task.date > today || (task.date === today && m > nowMin);
        if (past || future) {
          await api.upsertTask({ ...task, timeMinutes: m, isDone: past });
        }
      }
      onChange();
    } catch {
      // Rust-команда не дала сохранить: время занято другой задачей
      // (настройка «запрещать наложения» включена) — показываем диалог.
      const hit = findOverlap(m);
      if (hit) setConflictDlg({ task: hit, time: m ?? 0 });
    }
  };
  // «Добавить подзадачей»: подзадача с текущим текстом у конфликтующей
  // задачи; время у текущей не сохраняется (остаётся «в течение дня»).
  const addAsSubtask = async () => {
    if (!conflictDlg) return;
    const t = title.trim();
    if (!t) return;
    await api.upsertSubtask({ taskId: conflictDlg.task.id, title: t });
    setConflictDlg(null);
    onChange();
  };
  // Актуальные travel/duration — в ref: при быстрых кликах (выезд + длительность
  // подряд) task из пропсов ещё не обновился, и второй upsert затирал бы
  // значение первого. Мержим с ref-значениями.
  const metaRef = useRef({ travel: task.travelTime ?? null, duration: task.durationMinutes ?? null });
  metaRef.current = { travel: task.travelTime ?? null, duration: task.durationMinutes ?? null };
  const setTravel = async (m: number | null) => {
    metaRef.current = { ...metaRef.current, travel: m };
    try {
      await api.upsertTask({ ...task, travelTime: m, durationMinutes: metaRef.current.duration });
      onChange();
    } catch {
      /* время/длительность не меняются — конфликт невозможен; тихо */
    }
  };
  const setDuration = async (m: number | null) => {
    metaRef.current = { ...metaRef.current, duration: m };
    try {
      await api.upsertTask({ ...task, durationMinutes: m, travelTime: metaRef.current.travel });
      onChange();
    } catch {
      // Новый интервал пересекается с другой задачей — показываем диалог.
      if (task.timeMinutes != null) {
        const hit = findOverlap(task.timeMinutes, m);
        if (hit) setConflictDlg({ task: hit, time: task.timeMinutes });
      }
    }
  };

  // Доп. время: «09:00 – 10:30» (длительность) и «выезд в 08:15» (в пути).
  // Если длительность переваливает за полночь — помечаем «(+1 дн.)».
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const spanOf = (t: Task) => {
    const s = t.timeMinutes ?? 0;
    let out = fmt(s);
    if (t.durationMinutes) {
      const total = s + t.durationMinutes;
      const days = Math.floor(total / (24 * 60));
      out += `–${fmt(total % (24 * 60))}${days > 0 ? ` (+${days} дн.)` : ""}`;
    }
    return out;
  };
  const timeMeta: string[] = [];
  if (task.timeMinutes != null && task.durationMinutes) {
    const total = task.timeMinutes + task.durationMinutes;
    const days = Math.floor(total / (24 * 60));
    timeMeta.push(`${fmt(task.timeMinutes)}–${fmt(total % (24 * 60))}${days > 0 ? ` (+${days} дн.)` : ""}`);
  }
  if (task.timeMinutes != null && task.travelTime) {
    const dep = (task.timeMinutes - task.travelTime + 24 * 60) % (24 * 60);
    timeMeta.push(`выезд в ${fmt(dep)}`);
  }

  return (
    <div
      className="task-block"
      ref={setDropRef}
      style={{
        background: isDropTarget ? accentTint(0.08) : undefined,
        borderRadius: isDropTarget ? "var(--radius-sm)" : undefined,
        // Цветная линия категории слева — на весь блок (задача + подзадачи):
        // сразу видно, к какой категории относится задача.
        borderLeft: `3px solid ${setHex ?? "transparent"}`,
        paddingLeft: 4,
      }}
    >
    <div
      ref={setNodeRef}
      className={`task-line${isDragging ? " dragging" : ""}${timeConflict ? " time-conflict" : ""}`}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        background: timeConflict ? "rgba(224,82,82,0.09)" : "transparent",
        borderRadius: "var(--radius-sm)",
        ...dragStyle,
      }}
      title={timeConflict ? "Время пересекается с другой задачей" : undefined}
      onClick={(e) => {
        // Клик по элементам управления (чекбокс, время, ручка, поле текста) —
        // их собственные обработчики; открываем карточку по клику на любом
        // другом месте строки.
        const t = e.target as HTMLElement;
        if (t.closest("input, button, label, select, textarea, .task-drag-hint")) return;
        openCard();
      }}
      {...attributes}
    >
      {/* Ручка перетаскивания: ТОЛЬКО на ней listeners, чтобы клики по
          чекбоксу внутри строки работали. Явная подсказка «тяни тут». */}
      <span
        className="task-drag-hint"
        title="Зажмите и тяните на другой день"
        {...listeners}
        style={{
          flexShrink: 0,
          width: compact ? 16 : 20,
          marginRight: "var(--sp-2)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.secondary,
          opacity: 0.75,
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <Icon name="drag" size={16} />
      </span>
      <label className="checkbox-hit" title={task.isDone ? "Отметить невыполненной" : "Отметить выполненной"}>
        <input
          type="checkbox"
          checked={task.isDone}
          onChange={toggleDone}
          style={{ flexShrink: 0 }}
        />
      </label>
      {/* Текст + время + заметка. На мобильном CSS время переводит в колонку
          (под текстом); на десктопе — в ряд с текстом. Заметка всегда видна
          под текстом, пока пользователь не скроет её настройкой. */}
      <div
        className="task-text-wrap"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: compact ? "column" : "row",
          alignItems: compact ? "flex-start" : "center",
        }}
      >
        <textarea
          ref={textareaRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            save();
          }}
          onKeyDown={onKeyDown}
          onInput={(e) => growTitle(e.currentTarget)}
          onPointerDown={(e) => {
            // Тап по тексту существующей задачи открывает карточку (окно
            // с полными настройками); пустая строка — обычный ввод текста.
            if (task.title.trim()) {
              e.preventDefault();
              setCardOpen(true);
            }
          }}
          rows={1}
          data-task-id={task.id}
          title={title || undefined}
          style={{
            flex: "1 1 auto",
            width: "100%",
            fontSize: "inherit",
            border: "none",
            background: "transparent",
            outline: "none",
            padding: "4px 0",
            minWidth: 0,
            resize: "none",
            overflow: "hidden",
            lineHeight: 1.4,
            color: task.isDone ? COLORS.muted : COLORS.text,
            textDecoration: task.isDone ? "line-through" : "none",
          }}
        />
        {effectiveShowTime && !mobileRow && (!compact || task.timeMinutes != null) && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--sp-2)",
              flexShrink: 0,
            }}
          >
            <TimePicker
              value={task.timeMinutes ?? null}
              onChange={setTime}
              compact={compact}
              conflict={timeConflict}
              travelTime={task.travelTime ?? null}
              onChangeTravel={setTravel}
              durationMinutes={task.durationMinutes ?? null}
              onChangeDuration={setDuration}
            />
            {timeMeta.length > 0 && !compact && (
              <span
                style={{
                  fontSize: "var(--fs-2xs)",
                  color: COLORS.muted,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {timeMeta.join(" · ")}
              </span>
            )}
          </div>
        )}
        {/* На мобильном время и мета — НИЖЕ текста (как в сетке недели). */}
        {mobileRow && effectiveShowTime && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--sp-2)",
              margin: "1px 0 2px",
            }}
          >
            <TimePicker
              value={task.timeMinutes ?? null}
              onChange={setTime}
              compact
              conflict={timeConflict}
              travelTime={task.travelTime ?? null}
              onChangeTravel={setTravel}
              durationMinutes={task.durationMinutes ?? null}
              onChangeDuration={setDuration}
            />
            {timeMeta.length > 0 && (
              <span
                style={{
                  fontSize: "var(--fs-2xs)",
                  color: COLORS.muted,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {timeMeta.join(" · ")}
              </span>
            )}
          </div>
        )}
        {/* Заметка — всегда под текстом, пока не скрыта настройкой. */}
        {visibility.notes && task.notes && (
          <div
            style={{
              fontSize: "var(--fs-2xs)",
              color: COLORS.muted,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              padding: "0 0 2px",
              maxWidth: "100%",
            }}
          >
            {task.notes}
          </div>
        )}
      </div>
    </div>
    {/* Подзадачи под строкой (линия категории покрывает весь блок).
        Тап по подзадаче открывает карточку родительской задачи. */}
    {visibility.subtasks && (
      <SubtaskList taskId={task.id} onOpenCard={openCard} />
    )}
    {/* Карточка задачи: окно с полными настройками (время, приоритет,
        длительность, выезд, уведомление, категория, заметка, перенос,
        удаление) — открывается по нажатию на задачу. */}
    {cardOpen && (
      <AddTaskModal
        day={fromEpochDay(task.date)}
        initial={task}
        onChange={onChange}
        onClose={() => setCardOpen(false)}
      />
    )}
    {/* Диалог «время занято»: запрет наложений не дал сохранить время —
        предлагаем добавить текущую задачу как подзадачу к конфликтующей. */}
    {conflictDlg && (
      <div
        onClick={() => setConflictDlg(null)}
        style={{
          position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          style={{
            background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: "var(--radius-md)", padding: "var(--sp-6)",
            width: 340, maxWidth: "88vw", boxShadow: "var(--shadow-xl)",
          }}
        >
          <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: COLORS.text, marginBottom: "var(--sp-3)" }}>
            Время {fmt(conflictDlg.time)} занято
          </div>
          <div style={{ fontSize: "var(--fs-sm)", color: COLORS.secondary, marginBottom: "var(--sp-5)" }}>
            Задача «{conflictDlg.task.title}» ({spanOf(conflictDlg.task)}) уже стоит на
            этом времени. Добавить текущую как подзадачу к ней?
          </div>
          {title.trim() ? (
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button
                className="modal-action-btn"
                onClick={addAsSubtask}
                autoFocus
                style={{
                  flex: 1, padding: "var(--sp-3) var(--sp-4)", cursor: "pointer",
                  fontSize: "var(--fs-sm)", borderRadius: "var(--radius-md)",
                  border: "none", background: COLORS.accent, color: "#fff",
                }}
              >
                Добавить подзадачей
              </button>
              <button
                className="modal-action-btn"
                onClick={() => setConflictDlg(null)}
                style={{
                  flex: 1, padding: "var(--sp-3) var(--sp-4)", cursor: "pointer",
                  fontSize: "var(--fs-sm)", borderRadius: "var(--radius-md)",
                  border: `1px solid ${COLORS.cardBorder}`, background: "transparent",
                  color: COLORS.text,
                }}
              >
                Отмена
              </button>
            </div>
          ) : (
            <button
              className="modal-action-btn"
              onClick={() => setConflictDlg(null)}
              style={{
                width: "100%", padding: "var(--sp-3) var(--sp-4)", cursor: "pointer",
                fontSize: "var(--fs-sm)", borderRadius: "var(--radius-md)",
                border: `1px solid ${COLORS.cardBorder}`, background: "transparent",
                color: COLORS.text,
              }}
            >
              Отмена
            </button>
          )}
        </div>
      </div>
    )}
    </div>
  );
}
