import { useDroppable } from "@dnd-kit/core";
import { COLORS, accentTint } from "../theme";
import { weekShiftId } from "../drag";

interface Props {
  /** +1 — следующая неделя, -1 — прошлая. */
  dir: 1 | -1;
}

/**
 * Узкая боковая зона переноса задачи на соседнюю неделю (±7 дней от текущей
 * позиции задачи). Нужна, когда нужный день за пределами видимой недели —
 * например, сегодня воскресенье, а перенести надо на понедельник следующей.
 */
export function WeekShiftZone({ dir }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: weekShiftId(dir) });
  const next = dir === 1;
  return (
    <div
      ref={setNodeRef}
      title={
        next
          ? "Перенести на следующую неделю (+7 дней)"
          : "Перенести на прошлую неделю (−7 дней)"
      }
      style={{
        width: 30,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        writingMode: "vertical-rl",
        fontSize: "var(--fs-2xs)",
        fontWeight: 600,
        color: isOver ? COLORS.accent : COLORS.muted,
        background: isOver ? accentTint(0.12) : "transparent",
        borderRadius: "var(--radius-md)",
        margin: "var(--sp-2)",
        userSelect: "none",
      }}
    >
      {next ? "следующая неделя ▶" : "◀ прошлая неделя"}
    </div>
  );
}
