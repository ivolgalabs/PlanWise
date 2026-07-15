import { useState } from "react";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, colorSetHex } from "../theme";

interface Props {
  task: Task;
  onChange: () => void;
  onDragStart?: (t: Task) => void;
}

/** Карточка задачи: чекбокс done, inline-редактирование по двойному клику,
 * выбор цвета и удаление через меню. */
export function TaskCard({ task, onChange, onDragStart }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [colorMenu, setColorMenu] = useState(false);

  const save = async () => {
    const t = title.trim();
    if (t && t !== task.title) {
      await api.upsertTask({ ...task, title: t });
      onChange();
    }
    setEditing(false);
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

  const bg = task.isDone ? COLORS.setNone : colorSetHex(task.colorSetId);

  return (
    <div
      className="task-card"
      style={{ background: bg, position: "relative" }}
      draggable={!!onDragStart}
      onDragStart={() => onDragStart?.(task)}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "4px 6px" }}>
        <input
          type="checkbox"
          checked={task.isDone}
          onChange={toggleDone}
          style={{ marginRight: 6 }}
        />
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setTitle(task.title);
                setEditing(false);
              }
            }}
            style={{
              flex: 1,
              fontSize: 13,
              border: "none",
              background: "transparent",
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            style={{
              flex: 1,
              fontSize: 13,
              color: task.isDone ? COLORS.muted : COLORS.text,
              textDecoration: task.isDone ? "line-through" : "none",
              cursor: "pointer",
            }}
          >
            {task.title}
          </span>
        )}
        <button
          onClick={() => setColorMenu((v) => !v)}
          className="chip-btn"
          title="Цвет"
          style={{ marginLeft: 4 }}
        >
          ●
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
          <button onClick={del} className="del-btn" title="Удалить">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
