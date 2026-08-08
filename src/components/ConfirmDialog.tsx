import { COLORS } from "../theme";

interface Props {
  /** Текст вопроса (заголовок диалога). */
  title: string;
  /** Подпись кнопки подтверждения (по умолчанию «Удалить»). */
  confirmLabel?: string;
  /** Красная (опасная) кнопка подтверждения. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Кастомное окно подтверждения (например, «Удалить задачу?»).
 *  Оверлей + карточка, стиль как у DatePickerModal. Esc закрывает. */
export function ConfirmDialog({ title, confirmLabel = "Удалить", danger = true, onConfirm, onCancel }: Props) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: "var(--radius-md)",
          padding: "var(--sp-6)",
          width: 340,
          maxWidth: "88vw",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: COLORS.text, marginBottom: "var(--sp-5)" }}>
          {title}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <button
            className="modal-action-btn"
            onClick={onConfirm}
            autoFocus
            style={{
              flex: 1,
              padding: "var(--sp-3) var(--sp-4)",
              cursor: "pointer",
              fontSize: "var(--fs-sm)",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: danger ? "#d9534f" : COLORS.accent,
              color: "#fff",
            }}
          >
            {confirmLabel}
          </button>
          <button
            className="modal-action-btn"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "var(--sp-3) var(--sp-4)",
              cursor: "pointer",
              fontSize: "var(--fs-sm)",
              borderRadius: "var(--radius-md)",
              border: `1px solid ${COLORS.cardBorder}`,
              background: "transparent",
              color: COLORS.text,
            }}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
