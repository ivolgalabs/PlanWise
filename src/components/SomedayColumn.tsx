import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint } from "../theme";
import { TaskCard } from "./TaskCard";
import { somedayZoneId } from "../drag";
import { useStore } from "../store";
import { sortSomedayTasks } from "../date";
import { showToast } from "../toast";
import { useI18n } from "../i18n";

interface Props {
  tasks: Task[];
  onChange: () => void;
  /** Растянуть на всю высоту панели (когда мини-календарь скрыт/в месяце),
   *  чтобы под секцией не оставалось пустоты. */
  stretch?: boolean;
}

/** «Когда-нибудь» в правой панели: все задачи без дня одним списком. Мягкий срок
 *  (если задан) виден чипом на карточке и поднимает задачу выше (sortSomedayTasks).
 *  Принимает задачи drag-ом; перенос в день — обычным drag на колонку дня. */
export function SomedayColumn({ tasks, onChange, stretch = false }: Props) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: somedayZoneId });
  const sortMode = useStore((s) => s.sortMode);
  // По умолчанию свёрнуто (счётчик рядом с заголовком); разворачивает пользователь.
  const [collapsed, setCollapsedByUser] = useState(true);
  const items = sortSomedayTasks(tasks, sortMode);

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        maxHeight: stretch ? "none" : "45%",
        minHeight: 0,
        overflowY: "auto",
        borderTop: `1px solid var(--border-color)`,
        background: isOver ? accentTint(0.08) : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsedByUser(!collapsed)}
        title={collapsed ? t("common.expand") : t("common.collapse")}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          padding: "var(--sp-1) var(--sp-3)",
          fontSize: "var(--fs-sm)",
          fontWeight: 700,
          color: "var(--accent-text)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          width: "100%",
        }}
      >
        <span
          style={{
            fontSize: "var(--fs-xs)",
            width: 12,
            flexShrink: 0,
            display: "inline-block",
            transform: collapsed ? "rotate(-90deg)" : "none",
            transition: "transform 120ms",
          }}
        >
          ▾
        </span>
        {t("common.someday")}
        <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, fontWeight: 400 }}>{items.length}</span>
      </button>
      {!collapsed && (
        <>
          <div style={{ display: "flex", flexDirection: "column", padding: 4 }}>
            {items.map((x) => (
              <TaskCard key={x.id} task={x} onChange={onChange} showTime={false} />
            ))}
          </div>
          <SomedayAdd onChange={onChange} />
        </>
      )}
    </div>
  );
}

/** Строка добавления: создаёт задачу «Когда-нибудь» без срока. */
function SomedayAdd({ onChange }: { onChange: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const add = async () => {
    const title = value.trim();
    if (!title) return;
    try {
      await api.upsertTask({ title, date: 0, someday: true });
      setValue("");
    } catch (e) {
      showToast(t("err.saveTask", { error: String(e) }));
    }
    onChange();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      style={{ display: "flex", alignItems: "center", gap: 4, paddingRight: 4 }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        enterKeyHint="done"
        placeholder={t("someday.addSomeday")}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          outline: "none",
          color: COLORS.text,
        }}
      />
      {/* Видимая кнопка добавления: на Android «Готово» у enterKeyHint="done"
          может не отправить Enter-keypress, и форма молча не отправлялась —
          задача не создавалась. Тап по «+» работает всегда. */}
      <button
        type="submit"
        className="icon-btn"
        aria-label={t("someday.addAria")}
        disabled={!value.trim()}
        style={{ flexShrink: 0, opacity: value.trim() ? 1 : 0.45 }}
      >
        +
      </button>
    </form>
  );
}
