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
        background: "#EDE6D5",
        borderRadius: 8,
        padding: 2,
      }}
    >
      {items.map((it) => {
        const active = view === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: active ? 600 : 400,
              color: active ? COLORS.text : COLORS.muted,
              background: active ? COLORS.card : "transparent",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,.06)" : "none",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
