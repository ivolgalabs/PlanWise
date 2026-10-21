import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { Task } from "../api";
import { COLORS } from "../theme";
import { showToast } from "../toast";
import { toEpochDay } from "../date";
import { useI18n } from "../i18n";

/** После стольких переносов «Завтра» отказывает (то же число в Rust move_task). */
export const POSTPONE_LIMIT = 3;

/** Перенос упрётся в лимит Rust (check_postpone_limit): вместо тупика — окно первого шага. */
export const needsFirstStep = (task: Task, newDay: number, today = toEpochDay(new Date())) =>
  !task.isDone && !task.archived && !task.someday && task.date <= today && newDay > today && (task.postponeCount ?? 0) >= POSTPONE_LIMIT;

/** Окно ↻3: вместо серой «Завтра» — маленький первый шаг на завтра (исходная задача
 *  уходит в «Позже»), «Позже» или «Отпустить». «Отмена»/Esc/тап мимо ничего не меняют. */
export function FirstStepDialog({ task, onClose, onChange }: { task: Task; onClose: () => void; onChange: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState("");
  const busy = useRef(false); // двойной Enter/тап не должен создать шаг дважды

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<unknown>, toast?: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
      if (toast) showToast(toast);
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e));
    }
    onChange();
    onClose();
  };
  const title = task.title || t("common.untitled");
  const text = step.trim();

  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 300 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: COLORS.card,
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          padding: "var(--sp-6)",
          width: 360,
          maxWidth: "92vw",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: COLORS.text, marginBottom: "var(--sp-2)" }}>
          {title}
          <span className="task-time has stuck" style={{ marginLeft: "var(--sp-2)" }}>
            ↻{task.postponeCount ?? POSTPONE_LIMIT}
          </span>
        </div>
        <p style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-sm)", color: COLORS.secondary, lineHeight: 1.4 }}>
          {t("step.body")}
        </p>
        <input
          autoFocus
          value={step}
          onChange={(e) => setStep(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text) void doStep();
          }}
          placeholder={t("step.placeholder")}
          style={{
            width: "100%",
            font: "inherit",
            fontSize: "var(--fs-sm)",
            padding: "var(--sp-2)",
            color: "var(--text-primary)",
            background: "transparent",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--sp-3)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <button type="button" className="modal-action-btn primary" disabled={!text} onClick={() => void doStep()}>
            {t("step.do")}
          </button>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button
              type="button"
              className="modal-action-btn"
              style={{ flex: 1 }}
              onClick={() => run(() => api.setSomeday(task.id))}
            >
              {t("close.someday")}
            </button>
            <button type="button" className="modal-action-btn" style={{ flex: 1 }} onClick={() => run(() => api.dropTask(task.id))}>
              {t("close.drop")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );

  // Не атомарно: при сбое после первого шага задача остаётся на месте — дубль шага безвреден.
  function doStep() {
    return run(async () => {
      await api.upsertTask({ title: text, date: toEpochDay(new Date()) + 1, colorSetId: task.colorSetId ?? null, sortOrder: Date.now() });
      await api.setSomeday(task.id);
    }, t("step.toast", { title }));
  }
}
