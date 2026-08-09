import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint, argbToHex, hexToArgb } from "../theme";
import { useStore } from "../store";
import { TimePicker } from "./TimePicker";
import { SubtaskList } from "./SubtaskList";
import { DatePickerModal } from "./DatePickerModal";
import { ConfirmDialog } from "./ConfirmDialog";
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
 * слева. Enter в редактируемой строке сохраняет и создаёт новую строку ниже.
 * Перетаскивается через @dnd-kit (useDraggable) — drag за всю строку, активация
 * после сдвига мыши на 8px (обычный клик = ввод текста).
 */
export function TaskCard({ task, onChange, onCreateNext, showTime = true, compact = false }: Props) {
  const [title, setTitle] = useState(task.title);
  const [editing, editingSetter] = useState(false);
  const [colorMenu, setColorMenu] = useState(false);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#7eb8c4");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Авто-высота textarea: растёт по контенту, максимум ~4 строки (96px).
  const growTitle = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px";
  };
  const newCatRef = useRef<HTMLInputElement>(null);
  // Защита от двойного save: Enter (onKeyDown) и следующий за ним blur
  // (onBlur) вызывают save дважды подряд — пропускаем повторный вызов.
  const savedRef = useRef<number>(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesValue, setNotesValue] = useState(task.notes);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // Мобильный перенос: выбор даты через DatePickerModal (drag на телефоне
  // неудобен, кнопка видна только в тач-режиме — класс task-move-btn).
  const [moveOpen, setMoveOpen] = useState(false);
  // Подтверждение удаления: по кнопке «Удалить» показываем диалог.
  const [confirmDel, setConfirmDel] = useState(false);
  const { colorSets, setColorSets, visibility, tasks: allTasks, autoDonePastTime } = useStore();
  // На тач-устройствах время и кнопки действий собираются в одну строку под
  // текстом задачи (компактно), а не в ряд с текстом.
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

  // Синхронизируем локальный текст заметки, если задача изменилась извне.
  useEffect(() => {
    if (!notesOpen) setNotesValue(task.notes);
  }, [task.notes, notesOpen]);

  // При изменении текста/открытии — подгоняем высоту textarea.
  useEffect(() => {
    if (textareaRef.current) growTitle(textareaRef.current);
  }, [title, compact]);

  // При открытии панели растягиваем textarea под содержимое заметки.
  useEffect(() => {
    if (notesOpen && notesRef.current) growNotes(notesRef.current);
  }, [notesOpen]);

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

  const setColor = async (id: string | null) => {
    await api.upsertTask({ ...task, colorSetId: id });
    setColorMenu(false);
    onChange();
  };

  // Создать новую категорию прямо из меню и сразу применить к задаче.
  const createCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    const created = await api.upsertColorSet({
      name,
      color: hexToArgb(newCatColor),
    });
    setNewCatName("");
    setNewCatColor("#7eb8c4");
    setNewCatOpen(false);
    setColorMenu(false);
    setColorSets(await api.getColorSets());
    await api.upsertTask({ ...task, colorSetId: created.id });
    onChange();
  };

  const del = async () => {
    setConfirmDel(false);
    await api.deleteTask(task.id);
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
      await del();
    }
  };

  // Цвет категории задачи из загруженных сетов (undefined = без категории).
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
  // Подсветка наложений: задача, чьё время пересекается с другой (видны
  // и старые конфликты, независимо от настройки «запрещать наложения»).
  const timeConflict =
    task.timeMinutes != null && !task.isDone && findOverlap(task.timeMinutes) !== undefined;
  // Диалог «время занято»: Rust-команда вернула ошибку, показываем
  // конфликтующую задачу и предлагаем добавить текущую как подзадачу.
  const [conflictDlg, setConflictDlg] = useState<{ task: Task; time: number } | null>(null);

  // ── Приоритет задачи (0 = не задан, 1 = низкий, 2 = средний, 3 = высокий) ──
  const PRIO = useMemo(
    () => [
      { label: "", short: "", color: "" },
      { label: "низкий", short: "н", color: "#4caf50" },
      { label: "средний", short: "с", color: "#ffb300" },
      { label: "высокий", short: "в", color: "#e05252" },
    ],
    [],
  );
  const diff = task.difficulty ?? 0;
  const diffMeta = PRIO[diff] ?? PRIO[0];
  const cycleDifficulty = async () => {
    const next = diff >= 3 ? 0 : diff + 1;
    await api.upsertTask({ ...task, difficulty: next });
    onChange();
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
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  // Диапазон «12:00–13:00» задачи (для текста конфликт-диалога).
  const spanOf = (t: Task) => {
    const s = t.timeMinutes ?? 0;
    let out = fmt(s);
    if (t.durationMinutes) {
      out += `–${fmt((s + t.durationMinutes) % (24 * 60))}`;
    }
    return out;
  };
  const timeMeta: string[] = [];
  if (task.timeMinutes != null && task.durationMinutes) {
    const end = (task.timeMinutes + task.durationMinutes) % (24 * 60);
    timeMeta.push(`${fmt(task.timeMinutes)}–${fmt(end)}`);
  }
  if (task.timeMinutes != null && task.travelTime) {
    const dep = (task.timeMinutes - task.travelTime + 24 * 60) % (24 * 60);
    timeMeta.push(`выезд в ${fmt(dep)}`);
  }

  const saveNotes = async () => {
    if (notesValue !== task.notes) {
      await api.upsertTask({ ...task, notes: notesValue });
      onChange();
    }
  };

  // Авто-высота textarea по контенту (без скроллбара).
  const growNotes = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  return (
    <div
      className="task-block"
      ref={setDropRef}
      style={{
        background: isDropTarget ? accentTint(0.08) : undefined,
        borderRadius: isDropTarget ? "var(--radius-sm)" : undefined,
      }}
    >
    <div
      ref={setNodeRef}
      className={`task-line${isDragging ? " dragging" : ""}`}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        background: "transparent",
        borderRadius: "var(--radius-sm)",
        // Наложение по времени — красный маркер слева (видно в дне/неделе).
        boxShadow: timeConflict ? "inset 4px 0 0 0 rgba(224,82,82,0.75)" : undefined,
        ...dragStyle,
      }}
      title={timeConflict ? "Время пересекается с другой задачей" : undefined}
      {...attributes}
    >
      {/* Ручка перетаскивания: ТОЛЬКО на ней listeners, чтобы клики по
          чекбоксу/кнопкам внутри строки работали. Явная подсказка «тяни тут». */}
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
      {/* Цветная полоска слева (маркер сета) — тонкая, чтобы не раздувать
          строку лишней «колонкой»: 2px вместо 3. */}
      <div
        style={{
          width: 2,
          alignSelf: "stretch",
          borderRadius: "var(--radius-xs)",
          marginRight: compact ? 3 : 4,
          background: task.colorSetId ? setHex : "transparent",
        }}
      />
      <label className="checkbox-hit" title={task.isDone ? "Отметить невыполненной" : "Отметить выполненной"}>
        <input
          type="checkbox"
          checked={task.isDone}
          onChange={toggleDone}
          style={{ flexShrink: 0 }}
        />
      </label>
      {/* Инпут + время: в компактной сетке — колонкой (текст на всю ширину,
          время мелкой строкой под ним, только если задано); в обычном виде —
          в ряд, как раньше. На мобильном CSS переводит в колонку (task-text-wrap),
          чтобы текст занимал всю ширину строки. */}
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
          rows={1}
          data-task-id={task.id}
          title={title || undefined}
          style={{
            // flex-basis auto: flex-алгоритм учитывает высоту, заданную
            // growTitle (с flex-basis 0% строка не росла бы).
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
          <>
            <TimePicker
              value={task.timeMinutes ?? null}
              onChange={setTime}
              compact={compact}
              travelTime={task.travelTime ?? null}
              onChangeTravel={setTravel}
              durationMinutes={task.durationMinutes ?? null}
              onChangeDuration={setDuration}
            />
            {/* Диапазон «09:00–10:30» / «выезд в 08:15» — мелкой подписью под
                временем (длительность и время в пути). */}
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
          </>
        )}
      </div>
      {/* На мобильном справа от текста — время («09:00» или «в теч. дня»),
          цвет и удаление; под текстом остаются заметка и перенос. */}
      {mobileRow && (effectiveShowTime || visibility.taskActions) && (
        <div className="task-side">
          {effectiveShowTime && (
            <>
              <TimePicker
              value={task.timeMinutes ?? null}
              onChange={setTime}
              compact
              travelTime={task.travelTime ?? null}
              onChangeTravel={setTravel}
              durationMinutes={task.durationMinutes ?? null}
              onChangeDuration={setDuration}
            />
              {/* Диапазон «09:00–10:30» и «выезд в 08:15» — мелкими подписью
                  под временем, если заданы длительность/время в пути. */}
              {timeMeta.length > 0 && (
                <span
                  style={{
                    fontSize: "var(--fs-2xs)",
                    color: COLORS.muted,
                    lineHeight: 1.2,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {timeMeta.join(" · ")}
                </span>
              )}
            </>
          )}
          {visibility.taskActions && (
            <>
              {/* Приоритет задачи: клик циклично меняет уровень. */}
              <button
                onClick={cycleDifficulty}
                className="chip-btn"
                title={
                  diff
                    ? `Приоритет: ${diffMeta.label}. Нажмите, чтобы изменить`
                    : "Приоритет не задан. Нажмите, чтобы выбрать"
                }
                style={{
                  background: diff ? diffMeta.color : "transparent",
                  border: diff ? "none" : "1px solid " + COLORS.cardBorder,
                  color: diff ? "#fff" : COLORS.muted,
                  minWidth: 22,
                  fontSize: "var(--fs-2xs)",
                }}
              >
                {diff ? diffMeta.short : "⌀"}
              </button>
              <button
                onClick={() => setColorMenu((v) => !v)}
                className="chip-btn"
                title="Цвет"
                style={{
                  background: task.colorSetId ? setHex : "transparent",
                  border: task.colorSetId ? "none" : "1px solid " + COLORS.cardBorder,
                }}
              />
              <button onClick={() => setConfirmDel(true)} className="chip-btn" title="Удалить">
                <Icon name="close" size={13} />
              </button>
            </>
          )}
        </div>
      )}
      {/* Кнопки действий строки (десктоп): заметка, перенос, цвет/удаление.
          На мобильном они в строке с подзадачами (task-under). */}
      {!compact && !mobileRow && (
        <div
          className="task-chips"
          style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginLeft: "var(--sp-3)", flexShrink: 0 }}
        >
          {/* Заметка — подсвечена, если текст непустой. */}
          {showTime && visibility.notes && (
            <button
              className="chip-btn"
              onClick={() => setNotesOpen((v) => !v)}
              title="Заметка"
              style={{
                opacity: task.notes ? 1 : 0.5,
                color: task.notes ? COLORS.accent : COLORS.muted,
                flexShrink: 0,
              }}
            >
              <Icon name="note" size={13} />
            </button>
          )}
          {/* Перенос на другой день — только в тач-режиме. */}
          <button
            className="chip-btn task-move-btn"
            onClick={() => setMoveOpen(true)}
            title="Перенести на другой день"
            style={{ flexShrink: 0 }}
          >
            <Icon name="calendarCheck" size={13} />
          </button>
          {/* Кнопки цвета/удаления — скрываются настройкой. */}
          {visibility.taskActions && (
            <div className="task-actions" style={{ display: "flex", gap: "var(--sp-3)" }}>
              {/* Приоритет задачи: клик циклично меняет уровень. */}
              <button
                onClick={cycleDifficulty}
                className="chip-btn"
                title={
                  diff
                    ? `Приоритет: ${diffMeta.label}. Нажмите, чтобы изменить`
                    : "Приоритет не задан. Нажмите, чтобы выбрать"
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  color: diff ? diffMeta.color : COLORS.muted,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: diff ? diffMeta.color : COLORS.muted,
                    display: "inline-block",
                  }}
                />
                {diff ? diffMeta.label : "приоритет"}
              </button>
              <button
                onClick={() => setColorMenu((v) => !v)}
                className="chip-btn"
                title="Цвет"
                style={{
                  background: task.colorSetId ? setHex : "transparent",
                  border: task.colorSetId ? "none" : "1px solid " + COLORS.cardBorder,
                }}
              />
              <button onClick={() => setConfirmDel(true)} className="chip-btn" title="Удалить">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </div>
      )}
      {/* Меню цвета живёт внутри блока кнопок действий — если кнопки
          скрыты настройкой, меню тоже не показываем. */}
      {visibility.taskActions && !compact && colorMenu && (
        <div className="color-menu">
          <button
            className="color-option"
            onClick={() => setColor(null)}
            title="Без категории"
          >
            <span
              className="color-swatch"
              style={{ background: COLORS.tertiary }}
            />
            <span className="color-name">Без категории</span>
            {!task.colorSetId && <span className="color-check">✓</span>}
          </button>
          {colorSets
            .filter((s) => s.id !== "cs-none")
            .map((s) => (
              <button
                key={s.id}
                className="color-option"
                onClick={() => setColor(s.id)}
                title={s.name}
              >
                <span
                  className="color-swatch"
                  style={{ background: argbToHex(s.color) }}
                />
                <span className="color-name">{s.name}</span>
                {task.colorSetId === s.id && (
                  <span className="color-check">✓</span>
                )}
              </button>
            ))}
          <button
            className="color-option"
            onClick={() => {
              setNewCatOpen(true);
              requestAnimationFrame(() => newCatRef.current?.focus());
            }}
            title="Добавить категорию"
          >
            <span className="color-swatch color-swatch-add">+</span>
            <span className="color-name">Новая категория</span>
          </button>
          {newCatOpen && (
            <div
              className="color-menu-new"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={newCatRef}
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createCategory();
                  if (e.key === "Escape") setNewCatOpen(false);
                }}
                placeholder="Название категории"
              />
              <input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
              />
              <button onClick={createCategory} title="Создать">
                ✓
              </button>
            </div>
          )}
        </div>
      )}
    </div>
    {/* Панель заметки — раскрывается по клику на иконку, автосохранение
        по blur; Escape сохраняет и сворачивает. */}
    {showTime && visibility.notes && !compact && notesOpen && (
      <div className="notes-panel">
        <textarea
          ref={notesRef}
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          onInput={(e) => growNotes(e.currentTarget)}
          onBlur={() => saveNotes()}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing // игнорируем Enter во время IME-композиции
            ) {
              // «Применить»: сохранить и закрыть панель заметки.
              e.preventDefault();
              saveNotes();
              setNotesOpen(false);
            } else if (e.key === "Escape") {
              e.preventDefault();
              saveNotes();
              setNotesOpen(false);
            }
          }}
          placeholder="Заметка…"
          rows={2}
          autoFocus
        />
      </div>
    )}
      {/* На мобильном: ряд действий (заметка, перенос) живёт в одной строке
          с блоком подзадач — справа от него; сам блок обрезается по ширине
          (flex:1), чтобы кнопки поместились. */}
      {mobileRow ? (
        <div className="task-under">
          {visibility.subtasks && <SubtaskList taskId={task.id} />}
          <div className="task-under-btns">
            {showTime && visibility.notes && (
              <button
                className="chip-btn"
                onClick={() => setNotesOpen((v) => !v)}
                title="Заметка"
                style={{
                  opacity: task.notes ? 1 : 0.5,
                  color: task.notes ? COLORS.accent : COLORS.muted,
                  flexShrink: 0,
                }}
              >
                <Icon name="note" size={13} />
              </button>
            )}
            <button
              className="chip-btn"
              onClick={() => setMoveOpen(true)}
              title="Перенести на другой день"
              style={{ flexShrink: 0 }}
            >
              <Icon name="calendarCheck" size={13} />
            </button>
          </div>
        </div>
      ) : (
        visibility.subtasks && <SubtaskList taskId={task.id} />
      )}
    {/* Модалка выбора даты для переноса (мобильный режим). */}
    {moveOpen && (
      <DatePickerModal
        tasks={[]}
        onPick={async (d) => {
          await api.moveTask(task.id, d);
          setMoveOpen(false);
          onChange();
        }}
        onClose={() => setMoveOpen(false)}
      />
    )}
    {/* Подтверждение удаления задачи. */}
    {confirmDel && (
      <ConfirmDialog
        title={`Удалить задачу?`}
        confirmLabel="Удалить"
        onConfirm={del}
        onCancel={() => setConfirmDel(false)}
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
