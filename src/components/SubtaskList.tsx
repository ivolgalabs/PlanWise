import { useEffect, useState } from "react";
import type { Subtask } from "../api";
import { api } from "../api";
import { COLORS } from "../theme";

interface Props {
  taskId: string;
}

/**
 * Компактный чек-лист подзадач прямо под задачей — без отдельной кнопки
 * раскрытия. Inline-добавление: поле всегда видно, Enter добавляет строку.
 */
export function SubtaskList({ taskId }: Props) {
  const [items, setItems] = useState<Subtask[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const load = async () => {
    setItems(await api.getSubtasks(taskId));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

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

  return (
    <div style={{ paddingLeft: "calc(var(--sp-4) + 14px)", paddingTop: "var(--sp-1)" }}>
      <div style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, marginBottom: 2 }}>
        {items.length > 0 ? `подзадачи (${done}/${items.length})` : "подзадачи"}
      </div>
      {items.map((s) => (
        <div
          key={s.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            padding: "1px 0",
          }}
        >
          <input
            type="checkbox"
            checked={s.isDone}
            onChange={() => toggle(s)}
            style={{ margin: 0 }}
          />
          <span
            style={{
              flex: 1,
              fontSize: "var(--fs-2xs)",
              color: s.isDone ? COLORS.muted : COLORS.text,
              textDecoration: s.isDone ? "line-through" : "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.title}
          </span>
          <button onClick={() => del(s.id)} className="chip-btn" title="Удалить">
            ✕
          </button>
        </div>
      ))}
      <input
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
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
    </div>
  );
}
