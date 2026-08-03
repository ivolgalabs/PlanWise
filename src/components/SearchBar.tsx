import { useEffect, useRef, useState } from "react";
import { fromEpochDay } from "../api";
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
  /** Границы произвольного периода «с/по» (epoch-day; null = край не задан). */
  from: number | null;
  to: number | null;
  onFrom: (v: number | null) => void;
  onTo: (v: number | null) => void;
  onClose: () => void;
}

type FilterKey = "period" | "status" | "sort";

/** Выпадающий фильтр: кнопка с текущим значением + меню-список (паттерн
 *  popup-меню TimePicker). Один открытый фильтр на панель (openKey в родителе). */
function FilterSelect<T extends string>({ label, value, options, open, onToggle, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  open: boolean;
  onToggle: () => void;
  onChange: (v: T) => void;
}) {
  const current = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <div style={{ position: "relative" }} data-filter>
      <button
        className="text-chip"
        onClick={onToggle}
        style={{
          border: `1px solid ${open ? COLORS.accent : "transparent"}`,
          background: open ? accentTint(0.1) : "transparent",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        title={current}
      >
        {label}: {current}
        <Icon name="chevronR" size={12} />
      </button>
      {open && (
        <div
          data-filter
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            background: COLORS.card,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 300,
            minWidth: 160,
            padding: 4,
          }}
        >
          {options.map(([v, l]) => (
            <button
              key={v}
              onClick={() => {
                onChange(v);
                onToggle();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                fontSize: "var(--fs-xs)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: v === value ? accentTint(0.1) : "transparent",
                color: COLORS.text,
                cursor: "pointer",
              }}
            >
              {l}
              {v === value && " ✓"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Полоса поиска: текст, категории (чипы с именами), период/статус/сортировка
 *  — компактные выпадающие фильтры в один ряд. */
export function SearchBar({ query, onQuery, color, onColor, period, status, sort, onPeriod, onStatus, onSort, from, to, onFrom, onTo, onClose }: Props) {
  const { colorSets } = useStore();
  const sets = colorSets.filter((s) => s.id !== "cs-none");
  // Какой фильтр раскрыт (один на панель); null — все свёрнуты.
  const [openKey, setOpenKey] = useState<FilterKey | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Клик вне панели сворачивает открытый фильтр.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenKey(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const toggle = (k: FilterKey) => setOpenKey((cur) => (cur === k ? null : k));

  return (
    <div ref={barRef} style={{ padding: "var(--sp-1) var(--sp-4)", borderBottom: `1px solid ${COLORS.cardBorder}`, display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
      {/* Ряд 1: инпут (заметно выше — текст не липнет к краям) + закрыть */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <input autoFocus value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Поиск задач…" className="inline-input" style={{ flex: 1, minWidth: 0, border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: "var(--fs-md)", background: "transparent", color: COLORS.text, outline: "none" }} />
        <button className="icon-btn" onClick={onClose} title="Закрыть поиск"><Icon name="close" size={14} /></button>
      </div>
      {/* Ряд 2: категории + период/статус/сортировка — один компактный ряд
          с переносом, чтобы не занимать лишнюю высоту */}
      <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", alignItems: "center", paddingBottom: 2 }}>
        <button className="text-chip" onClick={() => onColor(null)} style={{ border: `1px solid ${color === null ? COLORS.accent : "transparent"}`, background: color === null ? accentTint(0.1) : "transparent" }}>Все</button>
        {sets.map((c) => (
          <button key={c.id} className="text-chip" onClick={() => onColor(c.id)} title={c.name}
            style={{ border: `1px solid ${color === c.id ? COLORS.accent : "transparent"}`, background: color === c.id ? accentTint(0.1) : "transparent" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: argbToHex(c.color), flexShrink: 0 }} />
            {c.name}
          </button>
        ))}
        <FilterSelect label="Период" value={period} options={[["all", "Все"], ["today", "Сегодня"], ["overdue", "Просроч."], ["7days", "7 дней"], ["month", "Месяц"], ["custom", "Произвольный…"]] as const}
          open={openKey === "period"} onToggle={() => toggle("period")} onChange={onPeriod} />
        <FilterSelect label="Статус" value={status} options={[["all", "Все"], ["active", "Активные"], ["done", "Выполн."]] as const}
          open={openKey === "status"} onToggle={() => toggle("status")} onChange={onStatus} />
        <FilterSelect label="Сортировка" value={sort} options={[["dateAsc", "По дате ↑"], ["dateDesc", "По дате ↓"], ["alpha", "А-Я"], ["alphaDesc", "Я-А"], ["category", "Категория"]] as const}
          open={openKey === "sort"} onToggle={() => toggle("sort")} onChange={onSort} />
      </div>
      {/* Строка диапазона произвольного периода «с/по» */}
      {period === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-xs)", color: COLORS.muted }}>
          <span>с</span>
          <input
            type="date"
            value={from ? toISODate(from) : ""}
            onChange={(e) => onFrom(e.target.value ? fromISODate(e.target.value) : null)}
            style={{ border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-sm)", padding: "2px 6px", background: "transparent", color: COLORS.text, outline: "none" }}
          />
          <span>по</span>
          <input
            type="date"
            value={to ? toISODate(to) : ""}
            onChange={(e) => onTo(e.target.value ? fromISODate(e.target.value) : null)}
            style={{ border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-sm)", padding: "2px 6px", background: "transparent", color: COLORS.text, outline: "none" }}
          />
        </div>
      )}
    </div>
  );
}

/** epoch-day → ISO-строка YYYY-MM-DD (для <input type="date">). */
const toISODate = (ed: number): string => {
  const d = fromEpochDay(ed);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** ISO-строка YYYY-MM-DD → epoch-day. */
const fromISODate = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};
