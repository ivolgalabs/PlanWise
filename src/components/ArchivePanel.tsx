import { useState } from "react";
import type { Task } from "../api";
import { api } from "../api";
import { fromEpochDay } from "../date";
import { COLORS } from "../theme";
import { Icon } from "./Icon";
import { DatePickerModal } from "./DatePickerModal";

interface Props {
  tasks: Task[];
  onClose: () => void;
  onChange: () => void;
}

/** Развёрнутый архив на всю правую панель: список скрытых задач и возврат
 *  на выбранную пользователем дату (DatePickerModal). Отдельной кнопкой —
 *  «Вернуть все на дату…»: все задачи архива возвращаются на выбранный день
 *  (например, на сегодня или любую дату в будущем). */
export function ArchivePanel({ tasks, onClose, onChange }: Props) {
  // Задача, для которой открыт выбор даты возврата.
  const [restoring, setRestoring] = useState<Task | null>(null);
  // Режим «вернуть все»: одна дата для всех задач архива.
  const [restoringAll, setRestoringAll] = useState(false);
  // Результат массового возврата (конфликты времени пропускаются, остальные
  // возвращаются — пользователь видит итог).
  const [restoreMsg, setRestoreMsg] = useState("");

  const restore = async (t: Task, d: Date) => {
    await api.restoreArchived(t.id, d);
    setRestoring(null);
    onChange();
  };

  const restoreAll = async (d: Date) => {
    setRestoringAll(false);
    let ok = 0;
    let conflicts = 0;
    for (const t of tasks) {
      try {
        await api.restoreArchived(t.id, d);
        ok += 1;
      } catch {
        conflicts += 1; // наложение по времени — задача осталась в архиве
      }
    }
    setRestoreMsg(
      conflicts === 0
        ? `Возвращено задач: ${ok}`
        : `Возвращено ${ok} из ${tasks.length}`,
    );
    onChange();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-2) var(--sp-3)",
          borderBottom: `1px solid var(--border-color)`,
        }}
      >
        <button className="icon-btn" onClick={onClose} title="Свернуть архив">
          <Icon name="chevronL" size={14} />
        </button>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--accent-text)" }}>
          Архив
        </span>
        <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
          {tasks.length}
        </span>
        {tasks.length > 0 && (
          <button
            onClick={() => setRestoringAll(true)}
            title="Вернуть все задачи архива на выбранную дату"
            style={{
              marginLeft: "auto",
              fontSize: "var(--fs-2xs)",
              border: `1px solid var(--border-color)`,
              background: "transparent",
              borderRadius: "var(--radius-md)",
              padding: "4px 10px",
              cursor: "pointer",
              color: COLORS.text,
              whiteSpace: "nowrap",
            }}
          >
            Вернуть все…
          </button>
        )}
      </div>
      {restoreMsg && (
        <div style={{ padding: "var(--sp-1) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted, borderBottom: `1px solid var(--border-color)` }}>
          {restoreMsg}
          {restoreMsg.includes("из") && " — задачи с пересечением по времени остались в архиве"}
        </div>
      )}
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
              borderBottom: `1px solid var(--border-color)`,
            }}
          >
            <label className="checkbox-hit">
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
            </label>
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
              onClick={() => setRestoring(t)}
              title="Вернуть на выбранную дату"
              style={{
                fontSize: "var(--fs-2xs)",
                flexShrink: 0,
                border: `1px solid var(--border-color)`,
                background: "transparent",
                borderRadius: "var(--radius-md)",
                padding: "4px 10px",
                cursor: "pointer",
                color: COLORS.text,
                whiteSpace: "nowrap",
              }}
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
      {restoringAll && (
        <DatePickerModal
          tasks={[]}
          onPick={(d) => void restoreAll(d)}
          onClose={() => setRestoringAll(false)}
        />
      )}
    </div>
  );
}
