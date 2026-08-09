import { useEffect, useState } from "react";
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
  /** Растянуть по высоте (flex:1) — для column-обёртки (неделя/месяц);
   *  без него — alignSelf stretch (день, row-контекст). */
  fill?: boolean;
  onSelect: (d: Date) => void;
  onChange: () => void;
}

/** Правая панель: мини-календарь сверху, «Когда-нибудь» под ним, полоска
 *  «Архив · N» внизу. Разворот архива занимает панель целиком. */
export function RightPanel({ tasks, width, onSelect, onChange, fill = false }: Props) {
  const { visibility, archivedTasks, view, panelGap } = useStore();
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Низкое окно (горизонтальный режим телефона): крупный календарь не
  // влезает по высоте и обрезается — рендерим компактный вариант, чтобы
  // панелька была видна полностью (обёртка всё равно скроллится).
  const [low, setLow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-height: 520px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-height: 520px)");
    const handler = (e: MediaQueryListEvent) => setLow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // Календарь виден не везде: в «Месяце» его нет, и настройкой его можно
  // скрыть. Тогда «Когда-нибудь» растягивается на всю панель (stretch),
  // чтобы под ней не оставалось мёртвого пространства.
  const calVisible = visibility.miniCalendar && view !== "month";

  return (
    <div
      style={{
        ...(width ? { width, flexShrink: 0 } : {}),
        // Растяжение по высоте: fill — flex:1 (column-обёртка недели/месяца);
        // иначе alignSelf:stretch (row-контекст дня). Не height:100% —
        // процентная высота при zoom (uiScale > 1) масштабируется дважды
        // и панель с архивом вылезала бы за край окна.
        ...(fill ? { flex: 1, minHeight: 0 } : { alignSelf: "stretch" }),
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
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
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", padding: "var(--sp-4) var(--sp-4) 0", minWidth: 0 }}>
              <MiniCalendar tasks={tasks} large={!low} onSelect={onSelect} fill={!low} />
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
