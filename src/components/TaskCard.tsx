import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS, accentTint, argbToHex } from "../theme";
import { useStore } from "../store";
import { formatMinutes } from "../date";
import { useMediaQuery } from "../useMediaQuery";
import { SubtaskList } from "./SubtaskList";
import { AddTaskModal } from "./AddTaskModal";
import { Icon } from "./Icon";
import { taskIdZone } from "../drag";

interface Props {
  task: Task;
  onChange: () => void;
  /** Создать новую пустую задачу сразу после этой (расширение по Enter). */
  onCreateNext?: (afterTaskId: string) => void;
  /** Показывать ли время задачи. По умолчанию true; компактная сетка недели
   *  рендерит время в компактном виде. */
  showTime?: boolean;
  /** Компактный режим для узких колонок сетки недели: меньше накладные
   *  отступы ручки/полоски/чекбокса, чтобы влезало поле задачи (≥40px). */
  compact?: boolean;
}

/**
 * Строка задачи: чекбокс + текст + время (ТОЛЬКО отображение) + цветной маркер
 * приоритета и линия категории. Клик/тап по тексту — редактирование текста
 * прямо в строке (на десктопе с выделением). Все настройки (время, приоритет,
 * категория, длительность, заметка, перенос, удаление, уведомление) — в
 * карточке задачи, которая открывается кнопкой «✎» справа от строки.
 * Заметка, если есть, видна под текстом (настройка «Заметки»).
 * Перетаскивается через @dnd-kit.
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
  // Селекторы: подписка только на нужные поля (иначе любой set() в сторе
  // перерендеривал бы каждую карточку задачи).
  const colorSets = useStore((s) => s.colorSets);
  const visibility = useStore((s) => s.visibility);
  const allTasks = useStore((s) => s.tasks);
  // На тач-устройствах время и мета собираются под текстом (компактно),
  // на десктопе — в ряд с текстом. Один общий listener на запрос — см.
  // useMediaQuery (раньше каждая задача вешала свой matchMedia-listener).
  const isTouch = useMediaQuery("(pointer: coarse), (max-width: 560px)");
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
    // Авто-удаление при пустом тексте — ТОЛЬКО если задача изначально была
    // пустой (создана Enter-ом и забыта).
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
        // Дедупликацию включаем только после РЕАЛЬНОЙ записи: blur без
        // изменений не должен съедать быстрое сохранение следующим Enter-ом.
        savedRef.current = now;
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

  // Приоритет задачи — цветной маркер в строке (не редактируется здесь,
  // меняется в карточке). Цвета — глобальные CSS-переменные приоритета
  // (themes.css), адаптируются к теме как остальная палитра.
  const PRIO_META: Record<number, { label: string; color: string }> = {
    1: { label: "низкий", color: "var(--prio-low)" },
    2: { label: "средний", color: "var(--prio-med)" },
    3: { label: "высокий", color: "var(--prio-high)" },
  };
  const prioMeta = PRIO_META[task.difficulty ?? 0];

  // Время показываем, только если его запросил родитель И настройка
  // «Время задач» включена.
  const effectiveShowTime = showTime && visibility.taskTime;

  // ── Пересечения по времени ────────────────────────────────────────
  // Задача «занимает» интервал [start, start+duration); без длительности —
  // одну минуту (мгновение). Одинаковое время двух задач = наложение.
  const intervalsOverlap = (m1: number, d1: number, m2: number, d2: number) =>
    m1 < m2 + Math.max(d2, 1) && m2 < m1 + Math.max(d1, 1);
  /** Другая задача того же дня, пересекающаяся с временем m. */
  const findOverlap = (m: number | null): Task | undefined => {
    if (m == null) return undefined;
    const d1 = task.durationMinutes ?? 0;
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
  // конфликты). Подсветка — цветной фон строки и красное время.
  const timeConflict =
    task.timeMinutes != null && !task.isDone && findOverlap(task.timeMinutes) !== undefined;
  // Карточка задачи (окно с полными настройками) — открывается ТОЛЬКО кнопкой
  // «✎» в строке задачи (в т.ч. из подзадач); у пустой строки-заглушки кнопка
  // просто ставит курсор.
  const [cardOpen, setCardOpen] = useState(false);

  // Время в строке — ТОЛЬКО отображение (изменение — в карточке задачи).
  // Формат: «09:00» + мета «09:00–10:30 · выезд в 08:15 (+1 дн.)».
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
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
  // Статичный «бейдж» времени: выглядит как раньше, но это не кнопка —
  // клик открывает карточку, где время настраивается.
  const timeBadge = (
    <span
      className={`task-time${task.timeMinutes != null ? " has" : ""}${timeConflict ? " conflict" : ""}`}
      title={timeConflict ? "Время пересекается с другой задачей" : task.timeMinutes != null ? "Нажмите, чтобы настроить время" : "Без привязки ко времени"}
    >
      {task.timeMinutes != null
        ? formatMinutes(task.timeMinutes)
        : compact
          ? "в теч. дня"
          : "в течение дня"}
    </span>
  );

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
        // В компактной сетке выравниваем по ПЕРВОЙ строке текста (flex-start),
        // а не по центру блока: когда под текстом появляется время, строка
        // становится выше, и центрирование «утапливало» чекбокс/ручку вниз —
        // ряд выглядел разъехавшимся.
        alignItems: compact ? "flex-start" : "center",
        background: timeConflict ? "color-mix(in srgb, var(--danger) 9%, transparent)" : "transparent",
        borderRadius: "var(--radius-sm)",
        ...dragStyle,
      }}
      title={timeConflict ? "Время пересекается с другой задачей" : undefined}
      onClick={(e) => {
        // Клик по элементам управления (чекбокс, ручка, поле текста, кнопка
        // «Редактировать») — их собственные обработчики. Любой другой клик
        // по строке (время, пустое место) — редактирование текста: фокус
        // в поле, на десктопе ещё и выделение всего текста.
        const t = e.target as HTMLElement;
        if (t.closest("input, button, label, select, textarea, .task-drag-hint")) return;
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        if (!isTouch) el.select();
      }}
      {...attributes}
    >
      {/* Ручка перетаскивания: ТОЛЬКО на ней listeners, чтобы клики по
          чекбоксу внутри строки работали. */}
      <span
        className="task-drag-hint"
        title="Зажмите и тяните на другой день"
        {...listeners}
        style={{
          flexShrink: 0,
          width: compact ? 16 : 20,
          marginRight: "var(--sp-2)",
          // В компактной сетке ряд выровнен по первой строке текста —
          // ручка прижимается к ней же (иначе иконка «плавает» выше текста).
          marginTop: compact ? 6 : 0,
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
          style={{ flexShrink: 0, ...(compact ? { marginTop: 2 } : {}) }}
        />
      </label>
      {/* Цветной маркер приоритета: виден в строке, настройка — в карточке. */}
      {prioMeta && (
        <span
          title={`Приоритет: ${prioMeta.label}`}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: prioMeta.color,
            flexShrink: 0,
            // В компактной сетке — к первой строке текста (как чекбокс).
            alignSelf: compact ? "flex-start" : "center",
            marginTop: compact ? 10 : 0,
            marginRight: "var(--sp-1)",
          }}
        />
      )}
      {/* Текст + время + заметка. На мобильном CSS время переводит в колонку
          (под текстом); на десктопе — в ряд с текстом. */}
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
            // Десктоп: клик мышью по полю — автовыбор (фокус + выделение
            // всего текста), чтобы сразу перезаписывать задачу.
            if (e.pointerType === "mouse") {
              const el = e.currentTarget;
              requestAnimationFrame(() => {
                el.focus();
                el.select();
              });
            }
            // Тач — нативный фокус и курсор в месте тапа.
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
            {timeBadge}
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
            {timeBadge}
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
      {/* Кнопка редактирования: ЕДИНСТВЕННЫЙ вход в карточку задачи (меню со
          временем, приоритетом, категорией и т.д.). Клик/тап по тексту —
          редактирование текста прямо в строке. class icon-btn: свайп по
          кнопке не переключает вид. */}
      <button
        type="button"
        className="icon-btn"
        onClick={() => setCardOpen(true)}
        title="Редактировать задачу (время, категория, заметка…)"
        style={{
          flexShrink: 0,
          marginLeft: "var(--sp-1)",
          // В компактной сетке кнопка — к первой строке текста, не к центру
          // блока (иначе при появлении времени под текстом ✎ «проваливалась»).
          alignSelf: compact ? "flex-start" : "center",
          marginTop: compact ? 4 : 0,
          width: compact ? 20 : 24,
          height: compact ? 20 : 24,
        }}
      >
        <Icon name="edit" size={compact ? 12 : 14} />
      </button>
    </div>
    {/* Подзадачи под строкой (линия категории покрывает весь блок).
        Текст подзадачи редактируется прямо в строке; карточка родительской
        задачи открывается кнопкой «✎» выше. */}
    {visibility.subtasks && (
      <SubtaskList taskId={task.id} />
    )}
    {/* Карточка задачи: окно с полными настройками (время, приоритет,
        длительность, выезд, уведомление, категория, заметка, подзадачи,
        перенос, удаление) — открывается кнопкой «✎». */}
    {cardOpen && (
      <AddTaskModal
        day={fromEpochDay(task.date)}
        initial={task}
        onChange={onChange}
        onClose={() => setCardOpen(false)}
      />
    )}
    </div>
  );
}
