import { useDroppable } from "@dnd-kit/core";
import { COLORS, accentTint } from "../theme";
import { weekShiftNextId } from "../drag";
import { useI18n } from "../i18n";
import { useMediaQuery } from "../useMediaQuery";

/**
 * Узкая боковая зона переноса задачи на следующую неделю (+7 дней от текущей
 * позиции задачи). Нужна, когда нужный день за пределами видимой недели —
 * например, сегодня воскресенье, а перенести надо на понедельник следующей.
 * Перенос в прошлую неделю убран по желанию пользователя.
 */
export function WeekShiftZone() {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: weekShiftNextId });
  // На телефоне полоса съедает ширину, а перетаскивание там редкое.
  const narrow = useMediaQuery("(max-width: 820px)");
  if (narrow) return null;
  return (
    <div
      ref={setNodeRef}
      title={t("weekShift.title")}
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
      {t("weekShift.label")}
    </div>
  );
}
