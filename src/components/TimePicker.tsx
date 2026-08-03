import { useState } from "react";
import { COLORS, accentTint } from "../theme";
import { formatMinutes, parseTimeToMinutes } from "../date";
import { Icon } from "./Icon";

interface Props {
  /** Текущее время в минутах, или null = «в течение дня». */
  value: number | null;
  /** onChange(minutes | null). null = «в течение дня». */
  onChange: (m: number | null) => void;
  /** Компактный режим (сетка недели): без времени — только иконка часов. */
  compact?: boolean;
}

/** Компактный time-picker: «в течение дня» / ввод ЧЧ:ММ / быстрые пресеты. */
export function TimePicker({ value, onChange, compact = false }: Props) {
  const [custom, setCustom] = useState("");
  const [editing, setEditing] = useState(false);

  const presets = [
    { label: "09:00", m: 9 * 60 },
    { label: "12:00", m: 12 * 60 },
    { label: "15:00", m: 15 * 60 },
    { label: "18:00", m: 18 * 60 },
    { label: "21:00", m: 21 * 60 },
  ];

  return (
    <div style={pickerStyle}>
      <button
        onClick={() => setEditing((v) => !v)}
        style={{
          ...badgeStyle(value !== null),
          cursor: "pointer",
          border: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-3)",
        }}
        title="Изменить время"
      >
        <Icon name="clock" size={13} /> {value !== null ? formatMinutes(value) : compact ? "" : "в течение дня"}
      </button>

      {editing && (
        <div style={menuStyle}>
          <button style={presetBtn(value === null)} onClick={() => { onChange(null); setEditing(false); }}>
            в течение дня
          </button>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", margin: "var(--sp-2) 0" }}>
            {presets.map((p) => (
              <button key={p.m} style={presetBtn(value === p.m)} onClick={() => { onChange(p.m); setEditing(false); }}>
                {p.label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const m = parseTimeToMinutes(custom);
              if (m !== null) {
                onChange(m);
                setEditing(false);
                setCustom("");
              }
            }}
            style={{ display: "flex", gap: "var(--sp-2)" }}
          >
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="16:32"
              style={inputStyle}
            />
            <button type="submit" style={submitStyle}>ок</button>
          </form>
        </div>
      )}
    </div>
  );
}

const pickerStyle: React.CSSProperties = { position: "relative", display: "inline-flex" };
function badgeStyle(hasTime: boolean): React.CSSProperties {
  return {
    fontSize: "var(--fs-2xs)",
    color: hasTime ? COLORS.accent : COLORS.muted,
    background: hasTime ? accentTint(0.1) : "transparent",
    padding: "1px 6px",
    borderRadius: "var(--radius-md)",
  };
}
const menuStyle: React.CSSProperties = {
  position: "absolute", right: 0, top: "100%", marginTop: 4,
  background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: "var(--radius-md)", padding: "var(--sp-2)",
  boxShadow: "var(--shadow-lg)", zIndex: 200, minWidth: 180,
};
function presetBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: "var(--fs-2xs)", padding: "3px 6px", cursor: "pointer",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
    background: active ? accentTint(0.1) : "transparent",
    color: active ? COLORS.accent : COLORS.text, borderRadius: "var(--radius-sm)",
  };
}
const inputStyle: React.CSSProperties = {
  width: 60, fontSize: "var(--fs-xs)", border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: "var(--radius-sm)", padding: "2px 4px", background: "transparent",
  color: COLORS.text,
};
const submitStyle: React.CSSProperties = {
  fontSize: "var(--fs-2xs)", padding: "2px 6px", cursor: "pointer",
  border: `1px solid ${COLORS.accent}`, background: COLORS.accent, color: "#fff",
  borderRadius: "var(--radius-sm)",
};
