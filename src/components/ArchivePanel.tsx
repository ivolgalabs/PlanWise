import { useState } from "react";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS } from "../theme";
import { Icon } from "./Icon";
import { DatePickerModal } from "./DatePickerModal";

interface Props {
  tasks: Task[];
  onClose: () => void;
  onChange: () => void;
}

/** Развёрнутый архив на всю правую панель: список скрытых задач и возврат
 *  на выбранную пользователем дату (DatePickerModal). */
export function ArchivePanel({ tasks, onClose, onChange }: Props) {
  // Задача, для которой открыт выбор даты возврата.
  const [restoring, setRestoring] = useState<Task | null>(null);

  const restore = async (t: Task, d: Date) => {
    await api.restoreArchived(t.id, d);
    setRestoring(null);
    onChange();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-2) var(--sp-3)",
          borderBottom: `1px solid ${COLORS.cardBorder}`,
        }}
      >
        <button className="icon-btn" onClick={onClose} title="Свернуть архив">
          <Icon name="chevronL" size={14} />
        </button>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: COLORS.accent }}>
          Архив
        </span>
        <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
          {tasks.length}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "var(--sp-2)" }}>
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
            Архив пуст.
          </p>
        )}
        {tasks.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              padding: "var(--sp-1) 0",
              borderBottom: `1px solid ${COLORS.cardBorder}`,
            }}
          >
            <input
              type="checkbox"
              checked={t.isDone}
              onChange={async () => {
                await api.upsertTask({ ...t, isDone: !t.isDone });
                onChange();
              }}
              title={t.isDone ? "Отметить невыполненной" : "Отметить выполненной"}
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "var(--fs-sm)",
                color: t.isDone ? COLORS.muted : COLORS.text,
                textDecoration: t.isDone ? "line-through" : "none",
              }}
            >
              {t.title || "(без названия)"}
            </span>
            <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, flexShrink: 0 }}>
              {fromEpochDay(t.date).toLocaleDateString("ru", { day: "numeric", month: "short" })}
            </span>
            <button
              className="chip-btn"
              onClick={() => setRestoring(t)}
              title="Вернуть на выбранную дату"
              style={{ fontSize: "var(--fs-2xs)", flexShrink: 0 }}
            >
              Вернуть…
            </button>
          </div>
        ))}
      </div>
      {restoring && (
        <DatePickerModal
          tasks={[]}
          onPick={(d) => restore(restoring, d)}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}
