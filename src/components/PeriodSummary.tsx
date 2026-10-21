import type { Task } from "../api";
import { COLORS, setHex } from "../theme";
import { useStore } from "../store";
import { useI18n } from "../i18n";

/** Сводка периода (месяц, неделя): сделано / отпущено / застряло (↻3) и сделанное по категориям.
 *  `inPeriod` — попадает ли epoch-day задачи в период; «Позже» и архив не считаются. */
export function PeriodSummary({ tasks, inPeriod }: { tasks: Task[]; inPeriod: (epochDay: number) => boolean }) {
  const { t } = useI18n();
  const colorSets = useStore((s) => s.colorSets);
  let done = 0;
  let dropped = 0;
  let stuck = 0;
  const cats = new Map<string, number>();
  for (const x of tasks) {
    if (x.someday || x.archived || !inPeriod(x.date)) continue;
    if (x.droppedAt) dropped++;
    else if (x.isDone) {
      done++;
      const k = !x.colorSetId || x.colorSetId === "cs-none" ? "" : x.colorSetId;
      cats.set(k, (cats.get(k) ?? 0) + 1);
    } else if ((x.postponeCount ?? 0) >= 3) stuck++;
  }
  if (done + dropped + stuck === 0) return null;
  const byCat = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--sp-1) var(--sp-4)",
        padding: "var(--sp-1) var(--sp-2) var(--sp-2)",
        fontSize: "var(--fs-sm)",
        color: COLORS.muted,
      }}
    >
      <span>{t("month.done")} <b style={{ color: COLORS.text }}>{done}</b></span>
      <span>{t("month.dropped")} <b style={{ color: COLORS.text }}>{dropped}</b></span>
      {stuck > 0 && <span style={{ color: "var(--danger)" }}>{t("month.stuck")} <b>{stuck}</b></span>}
      {byCat.map(([key, n]) => (
        <span key={key || "_none"} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: key === "" ? COLORS.muted : (setHex(colorSets, key) ?? COLORS.muted),
            }}
          />
          {n}
        </span>
      ))}
    </div>
  );
}
