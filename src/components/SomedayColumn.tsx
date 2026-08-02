import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint } from "../theme";
import { TaskCard } from "./TaskCard";
import { somedayZoneId } from "../drag";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/** Колонка «Когда-нибудь» (аналог Someday в tweek): задачи без привязки ко дню.
 *  Принимает задачи drag-ом; перенос в день — обычным drag на колонку дня. */
export function SomedayColumn({ tasks, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const { setNodeRef, isOver } = useDroppable({ id: somedayZoneId });

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
        width: 280,
        flexShrink: 0,
        borderLeft: `1px solid ${COLORS.cardBorder}`,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: isOver ? accentTint(0.08) : undefined,
      }}
    >
      <div
        style={{
          padding: "var(--sp-2) var(--sp-3)",
          fontSize: "var(--fs-sm)",
          fontWeight: 700,
          color: COLORS.accent,
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
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onChange={onChange} showTime={false} />
        ))}
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
            Задачи без даты. Перетащите сюда или напишите ниже.
          </p>
        )}
      </div>
      <input
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="+ когда-нибудь"
        style={{
          width: "100%",
          border: "none",
          borderTop: `1px solid ${COLORS.cardBorder}`,
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          outline: "none",
          color: COLORS.text,
        }}
      />
    </div>
  );
}
