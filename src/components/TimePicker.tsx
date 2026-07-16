import { useState } from "react";
import { COLORS } from "../theme";
import { formatMinutes, parseTimeToMinutes } from "../date";

interface Props {
  /** Текущее время в минутах, или null = «в течение дня». */
  value: number | null;
  /** onChange(minutes | null). null = «в течение дня». */
  onChange: (m: number | null) => void;
}

/** Компактный time-picker: «в течение дня» / ввод ЧЧ:ММ / быстрые пресеты. */
export function TimePicker({ value, onChange }: Props) {
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
      <div style={rowStyle}>
        <span style={badgeStyle(value !== null)}>
          ⏰ {value !== null ? formatMinutes(value) : "в течение дня"}
        </span>
        <button className="chip-btn" onClick={() => setEditing((v) => !v)} title="Время">
          {value !== null ? "изм" : "+"}
        </button>
      </div>

      {editing && (
        <div style={menuStyle}>
          <button style={presetBtn(value === null)} onClick={() => { onChange(null); setEditing(false); }}>
            в течение дня
          </button>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0" }}>
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
            style={{ display: "flex", gap: 4 }}
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
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4 };
function badgeStyle(hasTime: boolean): React.CSSProperties {
  return {
    fontSize: "var(--fs-2xs)",
    color: hasTime ? COLORS.accent : COLORS.muted,
    background: hasTime ? COLORS.accent + "1A" : "transparent",
    padding: "1px 6px",
    borderRadius: "var(--radius-full)",
  };
}
const menuStyle: React.CSSProperties = {
  position: "absolute", right: 0, top: "100%", marginTop: 4,
  background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: "var(--radius-lg)", padding: "var(--sp-2)",
  boxShadow: "var(--shadow-lg)", zIndex: 200, minWidth: 180,
};
function presetBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: "var(--fs-2xs)", padding: "3px 6px", cursor: "pointer",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
    background: active ? COLORS.accent + "1A" : "transparent",
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
