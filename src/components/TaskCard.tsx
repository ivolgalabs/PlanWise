import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint, argbToHex, hexToArgb } from "../theme";
import { useStore } from "../store";
import { TimePicker } from "./TimePicker";
import { SubtaskList } from "./SubtaskList";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const newCatRef = useRef<HTMLInputElement>(null);
  // Защита от двойного save: Enter (onKeyDown) и следующий за ним blur
  // (onBlur) вызывают save дважды подряд — пропускаем повторный вызов.
  const savedRef = useRef<number>(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesValue, setNotesValue] = useState(task.notes);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const { colorSets, setColorSets, visibility } = useStore();

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
      const updated = await api.upsertTask({ ...task, title: t });
      onChange();
      return updated;
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
    await api.deleteTask(task.id);
    onChange();
  };

  const setEditing = (v: boolean) => editingSetter(v);

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
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

  const setTime = async (m: number | null) => {
    await api.upsertTask({ ...task, timeMinutes: m });
    onChange();
  };

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
        background: task.isDone ? "transparent" : "transparent",
        borderRadius: 4,
        ...dragStyle,
      }}
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
          textAlign: "center",
          color: COLORS.secondary,
          opacity: 0.75,
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <Icon name="drag" size={16} />
      </span>
      {/* Цветная полоска слева (маркер сета) */}
      <div
        style={{
          width: "calc(var(--sp-2) - 1px)",
          alignSelf: "stretch",
          borderRadius: "var(--radius-xs)",
          marginRight: compact ? 4 : 6,
          background: task.colorSetId ? setHex : "transparent",
        }}
      />
      <input
        type="checkbox"
        checked={task.isDone}
        onChange={toggleDone}
        style={{ marginRight: compact ? 4 : 6, flexShrink: 0 }}
      />
      {/* Инпут + время: в компактной сетке — колонкой (текст на всю ширину,
          время мелкой строкой под ним, только если задано); в обычном виде —
          в ряд, как раньше. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: compact ? "column" : "row",
          alignItems: compact ? "flex-start" : "center",
        }}
      >
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            save();
          }}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            width: "100%",
            fontSize: "inherit",
            border: "none",
            background: "transparent",
            outline: "none",
            padding: "4px 0",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: task.isDone ? COLORS.muted : COLORS.text,
            textDecoration: task.isDone ? "line-through" : "none",
          }}
          data-task-id={task.id}
          title={title || undefined}
        />
        {effectiveShowTime && (!compact || task.timeMinutes != null) && (
          <TimePicker value={task.timeMinutes ?? null} onChange={setTime} compact={compact} />
        )}
      </div>
      {/* Заметка — кнопка рядом со временем, скрывается настройкой и в
          компактной сетке недели (не влезает). Подсвечена, если текст
          непустой. */}
      {showTime && visibility.notes && !compact && (
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
          <Icon name="note" size={14} />
        </button>
      )}
      {/* Кнопки цвета/удаления — приглушены, ярче при hover; скрываются
          настройкой «Кнопки „цвет“ и „удалить“ в задачах». */}
      {visibility.taskActions && !compact && (
        <div className="task-actions" style={{ display: "flex", gap: "var(--sp-1)" }}>
          <button
            onClick={() => setColorMenu((v) => !v)}
            className="chip-btn"
            title="Цвет"
            style={{
              background: task.colorSetId ? setHex : "transparent",
              border: task.colorSetId ? "none" : "1px solid " + COLORS.cardBorder,
            }}
          />
          <button onClick={del} className="chip-btn" title="Удалить">
            <Icon name="close" size={14} />
          </button>
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
              style={{ background: COLORS.setNone }}
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
            if (e.key === "Escape") {
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
    {/* Подзадачи скрываются настройкой «Подзадачи». */}
    {visibility.subtasks && <SubtaskList taskId={task.id} />}
    </div>
  );
}
