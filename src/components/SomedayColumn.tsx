import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint } from "../theme";
import { TaskCard } from "./TaskCard";
import { somedayZoneId } from "../drag";
import { useStore } from "../store";
import { sortTasksByMode } from "../date";

interface Props {
  tasks: Task[];
  onChange: () => void;
  /** Растянуть на всю высоту панели (когда мини-календарь скрыт/в месяце),
   *  чтобы под секцией не оставалось пустоты. */
  stretch?: boolean;
}

/** Секция «Когда-нибудь» внутри правой панели (календарь сверху, эта секция
 *  под ним): задачи без привязки ко дню. Принимает задачи drag-ом; перенос
 *  в день — обычным drag на колонку дня. */
export function SomedayColumn({ tasks, onChange, stretch = false }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const { setNodeRef, isOver } = useDroppable({ id: somedayZoneId });
  const sortMode = useStore((s) => s.sortMode);
  // Сортировка «Когда-нибудь» — по тому же режиму, что и дни (время/сложность/
  // ручной порядок); время здесь обычно не задано, поэтому в основном работает
  // сортировка по сложности и ручной порядок.
  const sorted = sortTasksByMode(tasks, sortMode);

  const add = async () => {
    const t = newTitle.trim();
    if (!t) return;
    await api.upsertTask({ title: t, date: 0, someday: true });
    setNewTitle("");
    onChange();
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        // Растёт до 45% высоты панели (календарь сверху); без календаря
        // (stretch) — на всю высоту, чтобы не было мёртвого пространства.
        flex: "1 1 auto",
        maxHeight: stretch ? "none" : "45%",
        minHeight: 0,
        borderTop: `1px solid var(--border-color)`,
        background: isOver ? accentTint(0.08) : undefined,
      }}
    >
      <div
        style={{
          // Верхний отступ меньше: секция сидит ближе к календарю.
          padding: "var(--sp-1) var(--sp-3)",
          fontSize: "var(--fs-sm)",
          fontWeight: 700,
          color: "var(--accent-text)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
        }}
      >
        Когда-нибудь
        <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, fontWeight: 400 }}>
          {tasks.length}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 4 }}>
        {sorted.map((t) => (
          <TaskCard key={t.id} task={t} onChange={onChange} showTime={false} />
        ))}
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
            Задачи без даты. Перетащите сюда или напишите ниже.
          </p>
        )}
      </div>
      {/* Форма: «Далее/Готово» на мобильной клавиатуре добавляет задачу. */}
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
          placeholder="+ когда-нибудь"
          style={{
            width: "100%",
            border: "none",
            padding: "4px 8px",
            fontSize: 12,
            background: "transparent",
            outline: "none",
            color: COLORS.text,
          }}
        />
      </form>
    </div>
  );
}
