import { useState } from "react";
import type { Task } from "../api";
import { api } from "../api";
import { fromEpochDay } from "../date";
import { showToast } from "../toast";
import { COLORS } from "../theme";
import { Icon } from "./Icon";
import { DatePickerModal } from "./DatePickerModal";
import { useI18n } from "../i18n";

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
  const { t, lang } = useI18n();
  // Задача, для которой открыт выбор даты возврата.
  const [restoring, setRestoring] = useState<Task | null>(null);
  // Режим «вернуть все»: одна дата для всех задач архива.
  const [restoringAll, setRestoringAll] = useState(false);
  // Результат массового возврата (конфликты времени пропускаются, остальные
  // возвращаются — пользователь видит итог). partial — часть осталась в архиве.
  const [restoreMsg, setRestoreMsg] = useState<{ text: string; partial: boolean } | null>(null);

  const restore = async (task: Task, d: Date) => {
    try {
      await api.restoreArchived(task.id, d);
    } catch (e) {
      // Отказ (наложение по времени) раньше был unhandled rejection: модалка
      // закрывалась без объяснения, задача «оставалась» в архиве.
      showToast(String(e instanceof Error ? e.message : e));
    }
    setRestoring(null);
    onChange();
  };

  const restoreAll = async (d: Date) => {
    setRestoringAll(false);
    let ok = 0;
    let conflicts = 0;
    for (const task of tasks) {
      try {
        await api.restoreArchived(task.id, d);
        ok += 1;
      } catch {
        conflicts += 1; // наложение по времени — задача осталась в архиве
      }
    }
    setRestoreMsg(
      conflicts === 0
        ? { text: t("archive.restored", { n: ok }), partial: false }
        : { text: t("archive.restoredPartial", { n: ok, total: tasks.length }), partial: true },
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
        <button className="icon-btn" onClick={onClose} title={t("archive.collapse")}>
          <Icon name="chevronL" size={14} />
        </button>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--accent-text)" }}>
          {t("common.archive")}
        </span>
        <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
          {tasks.length}
        </span>
        {tasks.length > 0 && (
          <button
            onClick={() => setRestoringAll(true)}
            title={t("archive.restoreAllTitle")}
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
            {t("archive.restoreAll")}
          </button>
        )}
      </div>
      {restoreMsg && (
        <div style={{ padding: "var(--sp-1) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted, borderBottom: `1px solid var(--border-color)` }}>
          {restoreMsg.text}
          {restoreMsg.partial && t("archive.conflicts")}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "var(--sp-2)" }}>
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
            {t("archive.empty")}
          </p>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
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
                checked={task.isDone}
                onChange={async () => {
                  try {
                    await api.upsertTask({ ...task, isDone: !task.isDone });
                    onChange();
                  } catch (e) {
                    // Сбой записи иначе оставил бы чекбокс рассинхронизированным
                    // с БД и молча ничего не сообщил.
                    showToast(String(e instanceof Error ? e.message : e));
                  }
                }}
                title={task.isDone ? t("task.markUndone") : t("task.markDone")}
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
                color: task.isDone ? COLORS.muted : COLORS.text,
                textDecoration: task.isDone ? "line-through" : "none",
              }}
            >
              {task.title || t("common.noTitle")}
            </span>
            <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, flexShrink: 0 }}>
              {fromEpochDay(task.date).toLocaleDateString(lang, { day: "numeric", month: "short" })}
            </span>
            <button
              onClick={() => setRestoring(task)}
              title={t("archive.restoreTitle")}
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
              {t("archive.restore")}
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
