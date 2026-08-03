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
  const { visibility, archivedTasks, view, panelGap } = useStore();
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Календарь виден не везде: в «Месяце» его нет, и настройкой его можно
  // скрыть. Тогда «Когда-нибудь» растягивается на всю панель (stretch),
  // чтобы под ней не оставалось мёртвого пространства.
  const calVisible = visibility.miniCalendar && view !== "month";

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
          {visibility.miniCalendar && view !== "month" && (
            // Карточка календаря растягивается на всю область (fill), чтобы
            // под ней не оставалось мёртвого пространства. В «Месяце»
            // календарь не показываем — сетка месяца и так видна.
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "var(--sp-4) var(--sp-4) 0", minWidth: 0 }}>
              <MiniCalendar tasks={tasks} large onSelect={onSelect} fill />
            </div>
          )}
          {calVisible && (
            // Зазор между календарём и «Когда-нибудь» — настраивается
            // в настройках интерфейса (panelGap, px) и сохраняется.
            <div style={{ height: panelGap, flexShrink: 0 }} />
          )}
          {visibility.someday && (
            <SomedayColumn tasks={tasks.filter((t) => t.someday)} onChange={onChange} stretch={!calVisible} />
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
              background: "transparent",
              padding: "var(--sp-2) var(--sp-3)",
              fontSize: "var(--fs-sm)",
              fontWeight: 700,
              color: COLORS.accent,
              cursor: "pointer",
              marginTop: "auto",
            }}
          >
            <Icon name="archive" size={14} />
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
