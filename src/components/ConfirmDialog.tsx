import { useEffect } from "react";
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
  // Esc = отмена (как в DatePickerModal/MonthView).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className="modal-overlay"
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
          border: `1px solid var(--border-color)`,
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
            className={`modal-action-btn ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
            autoFocus
            style={{ flex: 1 }}
          >
            {confirmLabel}
          </button>
          <button
            className="modal-action-btn"
            onClick={onCancel}
            style={{ flex: 1 }}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
