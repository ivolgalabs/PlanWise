import { COLORS, PALETTES, MODE_LABEL } from "../theme";
import type { ModePref } from "../theme";

interface Props {
  mondayFirst: boolean;
  palette: string;
  modePref: ModePref;
  scale: string;
  onToggleMondayFirst: () => void;
  onPaletteChange: (p: string) => void;
  onModePrefChange: (m: ModePref) => void;
  onScaleChange: (s: string) => void;
  onClose: () => void;
}

const SCALES = [
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
  { id: "xl", label: "XL" },
];

const MODES: ModePref[] = ["light", "dark", "auto"];

/** Панель настроек: режим (Светлая/Тёмная/Авто), палитра, масштаб, неделя. */
export function SettingsPanel({
  mondayFirst,
  palette,
  modePref,
  scale,
  onToggleMondayFirst,
  onPaletteChange,
  onModePrefChange,
  onScaleChange,
  onClose,
}: Props) {
  const recommended = PALETTES.filter((p) => p.tier === "recommended");
  const optional = PALETTES.filter((p) => p.tier === "optional");
  const hidden = PALETTES.filter((p) => p.tier === "hidden");

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>Настройки</h3>
        <button onClick={onClose} className="icon-btn" style={{ marginLeft: "auto" }}>
          ✕
        </button>
      </div>

      {/* Режим освещения: 3 сегментные кнопки */}
      <Section title="Режим">
        <div style={{ display: "flex", gap: 6 }}>
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => onModePrefChange(m)}
              style={segmentBtn(modePref === m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </Section>

      {/* Палитра */}
      <Section title="Палитра">
        <PaletteGrid palettes={recommended} current={palette} onPick={onPaletteChange} />
      </Section>

      <Section title="Дополнительно">
        <PaletteGrid palettes={optional} current={palette} onPick={onPaletteChange} />
      </Section>

      <details style={{ marginTop: "var(--sp-4)" }}>
        <summary style={hintStyle}>Все палитры</summary>
        <div style={{ marginTop: "var(--sp-2)" }}>
          <PaletteGrid palettes={hidden} current={palette} onPick={onPaletteChange} />
        </div>
      </details>

      {/* Масштаб */}
      <Section title="Масштаб интерфейса">
        <div style={{ display: "flex", gap: 6 }}>
          {SCALES.map((s) => (
            <button
              key={s.id}
              onClick={() => onScaleChange(s.id)}
              style={segmentBtn(scale === s.id)}
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

function PaletteGrid({
  palettes,
  current,
  onPick,
}: {
  palettes: typeof PALETTES;
  current: string;
  onPick: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
      {palettes.map((p) => {
        const active = current === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            title={p.label}
            style={paletteBtn(active)}
          >
            <span style={{ ...swatchStyle, background: p.accent }} />
            <span style={{ fontSize: "var(--fs-xs)", color: active ? COLORS.accent : COLORS.text }}>
              {p.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- стили ---
const panelStyle: React.CSSProperties = {
  position: "fixed", top: 0, right: 0, bottom: 0, width: 300,
  background: COLORS.card, borderLeft: `1px solid ${COLORS.cardBorder}`,
  padding: "var(--sp-6)", boxShadow: "var(--shadow-lg)", zIndex: 100,
  overflowY: "auto", fontFamily: "var(--font-ui)",
};
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "center", marginBottom: "var(--sp-6)" };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: "var(--fs-lg)", color: COLORS.text };
const hintStyle: React.CSSProperties = {
  fontSize: "var(--fs-2xs)", color: COLORS.muted,
  textTransform: "uppercase", letterSpacing: 0.5,
  marginBottom: "var(--sp-2)", cursor: "pointer",
};
const labelStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", fontSize: "var(--fs-sm)", color: COLORS.text, cursor: "pointer",
};
const swatchStyle: React.CSSProperties = {
  width: 16, height: 16, borderRadius: "50%", border: `1px solid ${COLORS.cardBorder}`,
};

function segmentBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "var(--sp-2) var(--sp-3)", borderRadius: "var(--radius-md)",
    cursor: "pointer", fontSize: "var(--fs-sm)",
    fontWeight: active ? 700 : 400,
    color: active ? COLORS.accent : COLORS.text,
    background: active ? COLORS.accent + "1A" : "transparent",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
  };
}

function paletteBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: "var(--sp-2)",
    padding: "var(--sp-2) var(--sp-3)", borderRadius: "var(--radius-md)",
    cursor: "pointer",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
    background: active ? COLORS.accent + "1A" : "transparent",
  };
}
