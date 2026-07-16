import { useState } from "react";
import { COLORS, ALL_THEMES, paletteAccent } from "../theme";
import type { ThemeMode } from "../theme";

interface Props {
  mondayFirst: boolean;
  theme: string;
  scale: string;
  onToggleMondayFirst: () => void;
  onThemeChange: (t: string) => void;
  onScaleChange: (s: string) => void;
  onClose: () => void;
}

const SCALES = [
  { id: "80", label: "80%" },
  { id: "90", label: "90%" },
  { id: "100", label: "100%" },
  { id: "110", label: "110%" },
  { id: "125", label: "125%" },
  { id: "150", label: "150%" },
];

const FILTERS: { id: ThemeMode | "auto" | "all"; label: string }[] = [
  { id: "auto", label: "Авто" },
  { id: "all", label: "Все" },
  { id: "light", label: "Светлые" },
  { id: "dark", label: "Тёмные" },
  { id: "oled", label: "OLED" },
];

/** Панель настроек: тема (24 пресета + Авто), масштаб, неделя. */
export function SettingsPanel({
  mondayFirst,
  theme,
  scale,
  onToggleMondayFirst,
  onThemeChange,
  onScaleChange,
  onClose,
}: Props) {
  const [filter, setFilter] = useState<ThemeMode | "auto" | "all">(
    theme === "auto" ? "auto" : "all",
  );

  const visible =
    filter === "all"
      ? ALL_THEMES
      : ALL_THEMES.filter((t) => t.mode === filter);

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>Настройки</h3>
        <button onClick={onClose} className="icon-btn" style={{ marginLeft: "auto" }}>
          ✕
        </button>
      </div>

      {/* Тема: фильтр + сетка */}
      <Section title="Тема">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "var(--sp-3)" }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                if (f.id === "auto") onThemeChange("auto");
              }}
              style={segBtn(
                (f.id === "auto" && theme === "auto") ||
                  (f.id !== "auto" && filter === f.id),
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {theme === "auto" && (
          <div
            style={{
              fontSize: "var(--fs-2xs)",
              color: COLORS.muted,
              marginBottom: "var(--sp-2)",
            }}
          >
            Авто: следует за системной темой
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "var(--sp-2)",
          }}
        >
          {visible.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  onThemeChange(t.id);
                  setFilter(t.mode);
                }}
                title={t.label}
                style={themeBtn(active)}
              >
                <span style={{ ...swatch, background: paletteAccent(t.palette) }} />
                <span
                  style={{
                    fontSize: "var(--fs-2xs)",
                    color: active ? COLORS.accent : COLORS.text,
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {t.palette}
                </span>
                <span style={{ fontSize: 9, color: COLORS.muted }}>{t.mode}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Масштаб */}
      <Section title="Масштаб интерфейса">
        <div style={{ display: "flex", gap: 6 }}>
          {SCALES.map((s) => (
            <button
              key={s.id}
              onClick={() => onScaleChange(s.id)}
              style={segBtn(scale === s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Неделя */}
      <Section title="Неделя">
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={mondayFirst}
            onChange={onToggleMondayFirst}
            style={{ marginRight: 8 }}
          />
          Начинается с понедельника
        </label>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      <div style={hintStyle}>{title}</div>
      {children}
    </div>
  );
}

// --- стили ---
const panelStyle: React.CSSProperties = {
  position: "fixed", top: 0, right: 0, bottom: 0, width: 320,
  background: COLORS.card, borderLeft: `1px solid ${COLORS.cardBorder}`,
  padding: "var(--sp-6)", boxShadow: "var(--shadow-lg)", zIndex: 100,
  overflowY: "auto", fontFamily: "var(--font-ui)",
};
const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", marginBottom: "var(--sp-6)",
};
const titleStyle: React.CSSProperties = {
  margin: 0, fontSize: "var(--fs-lg)", color: COLORS.text,
};
const hintStyle: React.CSSProperties = {
  fontSize: "var(--fs-2xs)", color: COLORS.muted,
  textTransform: "uppercase", letterSpacing: 0.5,
  marginBottom: "var(--sp-2)",
};
const labelStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", fontSize: "var(--fs-sm)",
  color: COLORS.text, cursor: "pointer",
};
const swatch: React.CSSProperties = {
  width: 16, height: 16, borderRadius: "50%",
  border: `1px solid ${COLORS.cardBorder}`,
};

function segBtn(active: boolean): React.CSSProperties {
  return {
    padding: "var(--sp-1) var(--sp-3)", borderRadius: "var(--radius-md)",
    cursor: "pointer", fontSize: "var(--fs-2xs)",
    fontWeight: active ? 700 : 400,
    color: active ? COLORS.accent : COLORS.text,
    background: active ? COLORS.accent + "1A" : "transparent",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
  };
}

function themeBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: 2, padding: "var(--sp-2)", borderRadius: "var(--radius-md)",
    cursor: "pointer",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
    background: active ? COLORS.accent + "1A" : "transparent",
  };
}
