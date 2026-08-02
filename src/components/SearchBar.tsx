import { COLORS, argbToHex } from "../theme";
import { useStore } from "../store";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  /** Выбранный цвет-сет (null = все). */
  color: string | null;
  onColor: (c: string | null) => void;
  onClose: () => void;
}

/** Полоса поиска: текстовый фильтр + чипы фильтра по категориям. */
export function SearchBar({ query, onQuery, color, onColor, onClose }: Props) {
  const { colorSets } = useStore();
  const sets = colorSets.filter((s) => s.id !== "cs-none");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "var(--sp-1) var(--sp-4) var(--sp-2)",
        borderBottom: `1px solid ${COLORS.cardBorder}`,
      }}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Поиск задач…"
        className="inline-input"
        style={{
          flex: 1,
          minWidth: 0,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: "var(--radius-md)",
          padding: "var(--sp-1) var(--sp-3)",
          fontSize: "var(--fs-sm)",
          background: "transparent",
          color: COLORS.text,
          outline: "none",
        }}
      />
      <button
        onClick={() => onColor(null)}
        className="chip-btn"
        title="Все категории"
        style={{
          border: `1px solid ${color === null ? COLORS.accent : COLORS.cardBorder}`,
          color: COLORS.text,
          fontSize: "var(--fs-2xs)",
          padding: "2px 8px",
          opacity: color === null ? 1 : 0.5,
        }}
      >
        Все
      </button>
      {sets.map((c) => (
        <button
          key={c.id}
          onClick={() => onColor(c.id)}
          className="chip-btn"
          title={c.name}
          style={{
            background: argbToHex(c.color),
            border: `1px solid ${color === c.id ? COLORS.accent : COLORS.cardBorder}`,
            opacity: color !== null && color !== c.id ? 0.4 : 1,
          }}
        />
      ))}
      <button
        className="icon-btn"
        onClick={onClose}
        title="Закрыть поиск"
        style={{ fontSize: "var(--fs-xs)" }}
      >
        ✕
      </button>
    </div>
  );
}
