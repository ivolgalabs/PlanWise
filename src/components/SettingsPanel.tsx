import { COLORS, ALL_THEMES, paletteAccent } from "../theme";
import type { ThemeDef } from "../theme";

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
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
  { id: "xl", label: "XL" },
];

/** Панель настроек: тема (24 пресета Universal UI), масштаб, первый день. */
export function SettingsPanel({
  mondayFirst,
  theme,
  scale,
  onToggleMondayFirst,
  onThemeChange,
  onScaleChange,
  onClose,
}: Props) {
  const recommended = ALL_THEMES.filter((t) => t.tier === "recommended");
  const optional = ALL_THEMES.filter((t) => t.tier === "optional");
  const hidden = ALL_THEMES.filter((t) => t.tier === "hidden");

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 300,
        background: COLORS.card,
        borderLeft: `1px solid ${COLORS.cardBorder}`,
        padding: "var(--sp-8)",
        boxShadow: "var(--shadow-lg)",
        zIndex: 100,
        overflowY: "auto",
        fontFamily: "var(--font-ui)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: "var(--sp-8)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "var(--fs-lg)",
            color: COLORS.text,
          }}
        >
          Настройки
        </h3>
        <button
          onClick={onClose}
          className="icon-btn"
          style={{ marginLeft: "auto" }}
        >
          ✕
        </button>
      </div>

      {/* Масштаб */}
      <Section title="Масштаб интерфейса">
        <div style={{ display: "flex", gap: 6 }}>
          {SCALES.map((s) => (
            <button
              key={s.id}
              onClick={() => onScaleChange(s.id)}
              className="icon-btn"
              style={{
                flex: 1,
                fontWeight: scale === s.id ? 700 : 400,
                background: scale === s.id ? COLORS.accent + "26" : "transparent",
                color: scale === s.id ? COLORS.accent : COLORS.text,
                border: `1px solid ${
                  scale === s.id ? COLORS.accent : COLORS.cardBorder
                }`,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Первый день недели */}
      <Section title="Неделя">
        <label
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: "var(--fs-sm)",
            color: COLORS.text,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={mondayFirst}
            onChange={onToggleMondayFirst}
            style={{ marginRight: 8 }}
          />
          Начинается с понедельника
        </label>
      </Section>

      {/* Темы: рекомендуемые */}
      <Section title="Тема">
        <ThemeGrid
          themes={recommended}
          current={theme}
          onPick={onThemeChange}
          badge="рекомендуемые"
        />
      </Section>

      {/* Опциональные */}
      <Section title="Дополнительно">
        <ThemeGrid themes={optional} current={theme} onPick={onThemeChange} />
      </Section>

      {/* Скрытые */}
      <details style={{ marginTop: "var(--sp-6)" }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: "var(--fs-2xs)",
            color: COLORS.muted,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Все палитры (8)
        </summary>
        <div style={{ marginTop: "var(--sp-3)" }}>
          <ThemeGrid themes={hidden} current={theme} onPick={onThemeChange} />
        </div>
      </details>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "var(--sp-8)" }}>
      <div
        style={{
          fontSize: "var(--fs-2xs)",
          color: COLORS.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: "var(--sp-3)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function ThemeGrid({
  themes,
  current,
  onPick,
  badge,
}: {
  themes: ThemeDef[];
  current: string;
  onPick: (id: string) => void;
  badge?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "var(--sp-2)",
      }}
    >
      {themes.map((t) => {
        const active = current === t.id;
        const accent = paletteAccent(t.palette);
        return (
          <button
            key={t.id}
            onClick={() => onPick(t.id)}
            title={t.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--sp-1)",
              padding: "var(--sp-2)",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              border: `1px solid ${
                active ? COLORS.accent : COLORS.cardBorder
              }`,
              background: active ? COLORS.accent + "1A" : "transparent",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: accent,
                border: `1px solid ${COLORS.cardBorder}`,
              }}
            />
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
      {badge && (
        <span style={{ fontSize: 9, color: COLORS.muted, gridColumn: "1/-1" }}>
          {badge}
        </span>
      )}
    </div>
  );
}
