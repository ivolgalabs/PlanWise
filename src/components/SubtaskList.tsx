import { useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Subtask } from "../api";
import { api } from "../api";
import { COLORS } from "../theme";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { subtaskDragId } from "../drag";

interface Props {
  taskId: string;
  /** Список свёрнут (кнопка подзадач в строке задачи). */
  open?: boolean;
}

/**
 * Чек-лист подзадач под задачей: всегда виден — заголовок (если есть подзадачи),
 * список (строки draggable) и поле ввода «+ подзадача». Поле всегда на месте,
 * поэтому добавить подзадачу можно в любом виде.
 */
export function SubtaskList({ taskId, open = true }: Props) {
  const [items, setItems] = useState<Subtask[]>([]);
  const [newTitle, setNewTitle] = useState("");
  // Версия списков подзадач: после promote/смены родителя (drag.tsx) список
  // должен перечитаться — иначе удалённая подзадача «висит» у старого родителя.
  const subtaskRev = useStore((s) => s.subtaskRev);

  const load = async () => {
    setItems(await api.getSubtasks(taskId));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, subtaskRev]);

  const add = async () => {
    const t = newTitle.trim();
    if (!t) return;
    await api.upsertSubtask({ taskId, title: t });
    setNewTitle("");
    load();
  };

  const toggle = async (s: Subtask) => {
    await api.upsertSubtask({ ...s, isDone: !s.isDone });
    load();
  };

  const del = async (id: string) => {
    await api.deleteSubtask(id);
    load();
  };

  const done = items.filter((s) => s.isDone).length;

  // Всегда показываем блок подзадач: заголовок (если есть подзадачи) + список
  // + поле ввода. Это решает «нельзя добавить подзадачу» — поле всегда на месте.
  if (!open) return null;
  return (
    <div className="subtasks-area">
      {items.length > 0 && (
        <div
          style={{
            fontSize: "var(--fs-2xs)",
            color: COLORS.muted,
            marginBottom: 2,
            fontWeight: 600,
            userSelect: "none",
          }}
        >
          Подзадачи ({done}/{items.length})
        </div>
      )}
      {items.map((s) => (
        <SubtaskRow
          key={s.id}
          subtask={s}
          onToggle={() => toggle(s)}
          onDelete={() => del(s.id)}
        />
      ))}
      {/* Форма: на мобильной клавиатуре кнопка «Далее/Готово» (enterKeyHint)
          срабатывает как Enter — добавляет подзадачу. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          enterKeyHint="done"
          placeholder="+ подзадача"
          className="inline-input"
          style={{
            width: "100%",
            border: "none",
            padding: "1px 0",
            fontSize: "var(--fs-2xs)",
            background: "transparent",
            outline: "none",
            color: COLORS.text,
          }}
        />
      </form>
    </div>
  );
}

/** Строка подзадачи — draggable (можно перетащить в другой день → promote,
 *  или на другую задачу → сменить родителя). */
function SubtaskRow({
  subtask,
  onToggle,
  onDelete,
}: {
  subtask: Subtask;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: subtaskDragId(subtask.id),
    data: { subtask },
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "1px 0",
        opacity: isDragging ? 0.4 : undefined,
        // Шрифт строки = шрифт текста подзадачи: чекбокс (1em) не должен
        // вырастать больше текста (подзадача «больше самой задачи»).
        fontSize: "var(--fs-2xs)",
      }}
      {...attributes}
    >
      {/* Ручка перетаскивания подзадачи: listeners ТОЛЬКО тут, чтобы чекбокс и
          кнопку ✕ можно было кликать. Явная подсказка «тяни тут». */}
      <span
        {...listeners}
        title="Перетащите на день (→ задача) или на другую задачу"
        style={{
          flexShrink: 0,
          width: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.muted,
          opacity: 0.5,
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <Icon name="dots" size={14} />
      </span>
      <label className="checkbox-hit">
        <input
          type="checkbox"
          checked={subtask.isDone}
          onChange={onToggle}
          style={{ margin: 0 }}
        />
      </label>
      <span
        style={{
          flex: 1,
          fontSize: "var(--fs-2xs)",
          color: subtask.isDone ? COLORS.muted : COLORS.text,
          textDecoration: subtask.isDone ? "line-through" : "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {subtask.title}
      </span>
      <button onClick={onDelete} className="chip-btn" title="Удалить">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
