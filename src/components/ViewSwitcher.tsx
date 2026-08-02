import type { ViewKind } from "../store";
import { COLORS } from "../theme";

interface Props {
  view: ViewKind;
  onChange: (v: ViewKind) => void;
}

/** Сегментированный переключатель День/Неделя/Месяц. */
export function ViewSwitcher({ view, onChange }: Props) {
  const items: { key: ViewKind; label: string }[] = [
    { key: "day", label: "День" },
    { key: "week", label: "Неделя" },
    { key: "month", label: "Месяц" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-tertiary)",
        borderRadius: "var(--radius-md)",
        padding: 2,
        gap: 2,
      }}
    >
      {items.map((it) => {
        const active = view === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            style={{
              fontSize: "var(--fs-xs)",
              padding: "4px 10px",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              fontWeight: active ? 600 : 400,
              color: active ? COLORS.text : COLORS.muted,
              background: active ? "var(--bg-secondary)" : "transparent",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              height: "var(--control-h-sm)",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
