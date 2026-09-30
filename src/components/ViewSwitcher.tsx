import type { ViewKind } from "../store";
import { COLORS } from "../theme";
import { useI18n } from "../i18n";

interface Props {
  view: ViewKind;
  onChange: (v: ViewKind) => void;
}

/** Сегментированный переключатель День/Неделя/Месяц. */
export function ViewSwitcher({ view, onChange }: Props) {
  const { t } = useI18n();
  const items: { key: ViewKind; label: string }[] = [
    { key: "day", label: t("view.day") },
    { key: "week", label: t("view.week") },
    { key: "month", label: t("view.month") },
  ];
  return (
    <div
      className="view-switcher"
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
            className="view-switcher-btn"
            onClick={() => onChange(it.key)}
            style={{
              fontSize: "var(--fs-xs)",
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
