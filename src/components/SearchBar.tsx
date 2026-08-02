import { COLORS, argbToHex, accentTint } from "../theme";
import { useStore } from "../store";
import { Icon } from "./Icon";
import type { PeriodFilter, StatusFilter, SortKey } from "../views/SearchResults";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  /** Выбранный цвет-сет (null = все). */
  color: string | null;
  onColor: (c: string | null) => void;
  /** Период / статус / сортировка результатов. */
  period: PeriodFilter;
  status: StatusFilter;
  sort: SortKey;
  onPeriod: (v: PeriodFilter) => void;
  onStatus: (v: StatusFilter) => void;
  onSort: (v: SortKey) => void;
  onClose: () => void;
}

/**
 * Сегментированный ряд чипов-переключателей (период/статус/сортировка).
 * options — пары «значение, подпись», активный чип подсвечен акцентом.
 */
function SegRow<T extends string>({ label, value, options, onChange }: {
  label: string; value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
      <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, minWidth: 64, flexShrink: 0 }}>{label}</span>
      {options.map(([v, l]) => (
        <button key={v} className="text-chip" onClick={() => onChange(v)}
          style={{ border: `1px solid ${value === v ? COLORS.accent : COLORS.cardBorder}`, background: value === v ? accentTint(0.1) : "transparent" }}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Полоса поиска: текст, категории (чипы с именами), период/статус/сортировка. */
export function SearchBar({ query, onQuery, color, onColor, period, status, sort, onPeriod, onStatus, onSort, onClose }: Props) {
  const { colorSets } = useStore();
  const sets = colorSets.filter((s) => s.id !== "cs-none");
  return (
    <div style={{ padding: "var(--sp-1) var(--sp-4) var(--sp-2)", borderBottom: `1px solid ${COLORS.cardBorder}`, display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
      {/* Ряд 1: инпут + закрыть */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <input autoFocus value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Поиск задач…" className="inline-input" style={{ flex: 1, minWidth: 0, border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-md)", padding: "var(--sp-1) var(--sp-3)", fontSize: "var(--fs-sm)", background: "transparent", color: COLORS.text, outline: "none" }} />
        <button className="icon-btn" onClick={onClose} title="Закрыть поиск"><Icon name="close" size={14} /></button>
      </div>
      {/* Ряд 2: категории — чипы с цветом и именем */}
      <div style={{ display: "flex", gap: "var(--sp-1)", overflowX: "auto", paddingBottom: 2 }}>
        <button className="text-chip" onClick={() => onColor(null)} style={{ border: `1px solid ${color === null ? COLORS.accent : COLORS.cardBorder}`, background: color === null ? accentTint(0.1) : "transparent" }}>Все</button>
        {sets.map((c) => (
          <button key={c.id} className="text-chip" onClick={() => onColor(c.id)} title={c.name}
            style={{ border: `1px solid ${color === c.id ? COLORS.accent : COLORS.cardBorder}`, background: color === c.id ? accentTint(0.1) : "transparent" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: argbToHex(c.color), flexShrink: 0 }} />
            {c.name}
          </button>
        ))}
      </div>
      {/* Ряд 3: период / статус / сортировка */}
      <SegRow label="Период" value={period} options={[["all","Все"],["today","Сегодня"],["overdue","Просроч."],["7days","7 дней"],["month","Месяц"]] as const} onChange={onPeriod} />
      <SegRow label="Статус" value={status} options={[["all","Все"],["active","Активные"],["done","Выполн."]] as const} onChange={onStatus} />
      <SegRow label="Сортировка" value={sort} options={[["dateAsc","По дате ↑"],["dateDesc","По дате ↓"],["alpha","А-Я"],["time","По времени"],["category","Категория"]] as const} onChange={onSort} />
    </div>
  );
}
