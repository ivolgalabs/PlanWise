import { useEffect, useState } from "react";
import type { Subtask } from "../api";
import { api } from "../api";
import { COLORS } from "../theme";

interface Props {
  taskId: string;
}

/** Список подзадач (чек-лист) под задачей. Разворачивается по кнопке «＋». */
export function SubtaskList({ taskId }: Props) {
  const [items, setItems] = useState<Subtask[]>([]);
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const load = async () => {
    setItems(await api.getSubtasks(taskId));
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

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
    <div style={{ paddingLeft: "var(--sp-6)", paddingTop: "var(--sp-1)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="chip-btn"
        title="Подзадачи"
        style={{ width: "auto", padding: "1px 6px", fontSize: "var(--fs-2xs)" }}
      >
        {open ? "▾" : "▸"} подзадачи{items.length > 0 ? ` (${done}/${items.length})` : ""}
      </button>

      {open && (
        <div style={{ marginTop: "var(--sp-1)" }}>
          {items.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                padding: "2px 0",
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
              padding: "2px 0",
              fontSize: "var(--fs-2xs)",
              background: "transparent",
              outline: "none",
              color: COLORS.text,
            }}
          />
        </div>
      )}
    </div>
  );
}
