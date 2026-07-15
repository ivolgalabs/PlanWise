import { COLORS, THEMES } from "../theme";
import type { ThemeKind } from "../theme";

interface Props {
  mondayFirst: boolean;
  theme: ThemeKind;
  onToggleMondayFirst: () => void;
  onThemeChange: (t: ThemeKind) => void;
  onClose: () => void;
}

/** Панель настроек: тема, первый день недели. */
export function SettingsPanel({
  mondayFirst,
  theme,
  onToggleMondayFirst,
  onThemeChange,
  onClose,
}: Props) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 280,
        background: COLORS.card,
        borderLeft: `1px solid ${COLORS.cardBorder}`,
        padding: 16,
        boxShadow: "-4px 0 12px rgba(0,0,0,.05)",
        zIndex: 100,
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: COLORS.text }}>
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

      <label
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 13,
          color: COLORS.text,
          marginBottom: 20,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={mondayFirst}
          onChange={onToggleMondayFirst}
          style={{ marginRight: 8 }}
        />
        Неделя начинается с понедельника
      </label>

      <div style={{ marginBottom: 8, fontSize: 12, color: COLORS.muted }}>
        Тема
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(Object.keys(THEMES) as ThemeKind[]).map((key) => {
          const def = THEMES[key];
          const active = theme === key;
          return (
            <button
              key={key}
              onClick={() => onThemeChange(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
                background: active ? COLORS.accent + "1A" : "transparent",
                color: COLORS.text,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  gap: 2,
                }}
              >
                {(["--bg", "--accent", "--set-personal", "--set-sport"] as const).map(
                  (v) => (
                    <span
                      key={v}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: def.vars[v],
                        border: `1px solid ${COLORS.cardBorder}`,
                      }}
                    />
                  ),
                )}
              </span>
              {def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
