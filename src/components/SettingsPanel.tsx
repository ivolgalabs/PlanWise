import { COLORS } from "../theme";

interface Props {
  mondayFirst: boolean;
  onToggleMondayFirst: () => void;
  onClose: () => void;
}

/** Панель настроек: тема (заглушка), первый день недели. */
export function SettingsPanel({
  mondayFirst,
  onToggleMondayFirst,
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
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
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
          marginBottom: 16,
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

      <div style={{ fontSize: 11, color: COLORS.muted }}>
        Тема: Paper-white (по умолчанию)
      </div>
    </div>
  );
}
