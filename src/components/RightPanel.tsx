import { useState } from "react";
import type { Task } from "../api";
import { MiniCalendar } from "./MiniCalendar";
import { SomedayColumn } from "./SomedayColumn";
import { ArchivePanel } from "./ArchivePanel";
import { COLORS } from "../theme";
import { useStore } from "../store";
import { Icon } from "./Icon";

interface Props {
  tasks: Task[];
  /** Ширина панели (DayView); undefined — тянется по родителю (WeekView). */
  width?: number;
  onSelect: (d: Date) => void;
  onChange: () => void;
}

/** Правая панель: мини-календарь сверху, «Когда-нибудь» под ним, полоска
 *  «Архив · N» внизу. Разворот архива занимает панель целиком. */
export function RightPanel({ tasks, width, onSelect, onChange }: Props) {
  const { visibility, archivedTasks } = useStore();
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <div
      style={{
        ...(width ? { width, flexShrink: 0 } : {}),
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        borderLeft: `1px solid ${COLORS.cardBorder}`,
      }}
    >
      {archiveOpen ? (
        <ArchivePanel
          tasks={archivedTasks}
          onClose={() => setArchiveOpen(false)}
          onChange={onChange}
        />
      ) : (
        <>
          {visibility.miniCalendar && (
            // Нижний отступ меньше верхнего: «Когда-нибудь» сидит ближе к календарю.
            <div style={{ flex: 1, overflowY: "auto", padding: "var(--sp-4) var(--sp-4) var(--sp-2)", minWidth: 0 }}>
              <MiniCalendar tasks={tasks} large onSelect={onSelect} />
            </div>
          )}
          {visibility.someday && (
            <SomedayColumn tasks={tasks.filter((t) => t.someday)} onChange={onChange} />
          )}
          {/* Полоска «Архив · N» — всегда видна (N = 0 при пустом архиве) и
              прижата к низу панели (marginTop auto). */}
          <button
            onClick={() => setArchiveOpen(true)}
            title="Открыть архив"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              width: "100%",
              border: "none",
              borderTop: `1px solid ${COLORS.cardBorder}`,
              background: "transparent",
              padding: "var(--sp-2) var(--sp-3)",
              fontSize: "var(--fs-sm)",
              fontWeight: 700,
              color: COLORS.accent,
              cursor: "pointer",
              marginTop: "auto",
            }}
          >
            <Icon name="note" size={14} />
            Архив
            <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, fontWeight: 400 }}>
              {archivedTasks.length}
            </span>
          </button>
        </>
      )}
    </div>
  );
}
