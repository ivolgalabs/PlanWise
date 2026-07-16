import { useEffect, useRef, useState } from "react";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, colorSetHex } from "../theme";
import { TimePicker } from "./TimePicker";

interface Props {
  task: Task;
  onChange: () => void;
  onDragStart?: (t: Task) => void;
  /** Создать новую пустую задачу сразу после этой (расширение по Enter). */
  onCreateNext?: (afterTaskId: string) => void;
}

/**
 * Строка задачи (tweek-style line): чекбокс + inline-текст + цветная полоска
 * слева. Enter в редактируемой строке сохраняет и создаёт новую строку ниже.
 * Backspace в пустой — удаляет текущую и фокусирует предыдущую.
 */
export function TaskCard({ task, onChange, onDragStart, onCreateNext }: Props) {
  const [title, setTitle] = useState(task.title);
  const [editing, editingSetter] = useState(false);
  const [colorMenu, setColorMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Синхронизируем локальный title, если задача изменилась извне.
  useEffect(() => {
    if (!editing) setTitle(task.title);
  }, [task.title, editing]);

  const save = async (): Promise<Task> => {
    const t = title.trim();
    if (t && t !== task.title) {
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

  const setHex = colorSetHex(task.colorSetId);

  const setTime = async (m: number | null) => {
    await api.upsertTask({ ...task, timeMinutes: m });
    onChange();
  };

  return (
    <div
      className="task-line"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        background: task.isDone ? "transparent" : "transparent",
        borderRadius: 4,
      }}
      draggable={!!onDragStart}
      onDragStart={() => onDragStart?.(task)}
    >
      {/* Цветная полоска слева (маркер сета) */}
      <div
        style={{
          width: 3,
          alignSelf: "stretch",
          borderRadius: 2,
          marginRight: 6,
          background: task.colorSetId ? setHex : "transparent",
        }}
      />
      <input
        type="checkbox"
        checked={task.isDone}
        onChange={toggleDone}
        style={{ marginRight: 6, flexShrink: 0 }}
      />
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
          fontSize: 13,
          border: "none",
          background: "transparent",
          outline: "none",
          padding: "4px 0",
          color: task.isDone ? COLORS.muted : COLORS.text,
          textDecoration: task.isDone ? "line-through" : "none",
        }}
        data-task-id={task.id}
      />
      {/* Время — бейдж всегда виден, пикер по клику */}
      <TimePicker value={task.timeMinutes ?? null} onChange={setTime} />
      {/* Кнопки цвета/удаления — всегда видны (приглушены, ярче при hover) */}
      <div className="task-actions" style={{ display: "flex", gap: 2 }}>
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
          ✕
        </button>
      </div>
      {colorMenu && (
        <div className="color-menu">
          <button
            onClick={() => setColor(null)}
            style={{ background: COLORS.setNone }}
            title="Без категории"
          />
          <button
            onClick={() => setColor("cs-work")}
            style={{ background: COLORS.setWork }}
            title="Работа"
          />
          <button
            onClick={() => setColor("cs-personal")}
            style={{ background: COLORS.setPersonal }}
            title="Личное"
          />
          <button
            onClick={() => setColor("cs-sport")}
            style={{ background: COLORS.setSport }}
            title="Спорт"
          />
        </div>
      )}
    </div>
  );
}
