import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { Task } from "../api";
import { COLORS } from "../theme";
import { useStore } from "../store";
import { showToast } from "../toast";
import { fromEpochDay, toEpochDay } from "../date";
import { useI18n } from "../i18n";

/** После стольких переносов «Завтра» заблокировано (то же число в Rust move_task). */
const POSTPONE_LIMIT = 3;

/** «Обычно закрываешь N в день»: среднее по дням с закрытиями за 14 дней.
 *  Только после двух недель истории (есть закрытие старше 14 дней в окне 28). */
export function UsualLoad() {
  const { t } = useI18n();
  const [n, setN] = useState(0);
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 28);
    api
      .getTasks(start, end)
      .then((list) => {
        const now = Date.now();
        const span = 14 * 86_400_000;
        const done = list.filter((x) => x.isDone && !x.droppedAt && x.doneAt);
        if (!done.some((x) => now - x.doneAt! >= span)) return;
        const recent = done.filter((x) => now - x.doneAt! < span);
        const days = new Set(recent.map((x) => toEpochDay(new Date(x.doneAt!))));
        if (days.size) setN(Math.round(recent.length / days.size));
      })
      .catch((e) => showToast(errText(e)));
  }, []);
  if (n < 1) return null;
  return <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>{t("close.usual", { n })}</span>;
}

const errText = (e: unknown) => String(e instanceof Error ? e.message : e);

/** Кнопка «Закрыть день» (у сегодняшней колонки) + диалог разбора: у каждой
 *  открытой задачи сегодня и прошлых дней — завтра / когда-нибудь / отпустить,
 *  внизу заметка дня. После ↻3 «Завтра» заблокировано: пора отпустить или
 *  решить иначе. Действия применяются сразу; «Закрыть день» ставит closed_at. */
export function CloseDayButton({ onChange, compact = false }: { onChange: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const label = t("close.button");
  return (
    <>
      <button
        type="button"
        className="modal-action-btn compact"
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
        style={{ flexShrink: 0, alignSelf: "center", fontSize: "var(--fs-2xs)" }}
      >
        {compact ? "✓" : `✓ ${label}`}
      </button>
      {open && <CloseDayDialog onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function CloseDayDialog({ onChange, onClose }: { onChange: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const todayEd = toEpochDay(new Date());
  const tasks = useStore((s) => s.tasks);
  const open = tasks
    .filter((x) => !x.isDone && !x.someday && !x.archived && x.date <= todayEd)
    .sort((a, b) => a.date - b.date || a.sortOrder - b.sortOrder);
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState<{ note: string; closedAt: number | null } | null>(null);

  useEffect(() => {
    api
      .getDays(todayEd, todayEd)
      .then((d) => {
        const day = d[0];
        setNote(day?.note ?? "");
        setLoaded({ note: day?.note ?? "", closedAt: day?.closedAt ?? null });
      })
      .catch((e) => showToast(errText(e)));
  }, [todayEd]);

  // Заметка до загрузки не пишется: иначе пустой стейт затёр бы сохранённую.
  const saveDay = async (close: boolean) => {
    if (!loaded || (!close && note === loaded.note)) return;
    try {
      await api.upsertDay({ epochDay: todayEd, note, closedAt: close ? Date.now() : loaded.closedAt, updatedAt: 0 });
    } catch (e) {
      showToast(errText(e));
    }
  };
  const dismiss = async () => {
    await saveDay(false);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      showToast(errText(e));
    }
    onChange();
  };

  const row = (task: Task) => {
    const n = task.postponeCount ?? 0;
    const stuck = n >= POSTPONE_LIMIT;
    return (
      <div key={task.id} style={{ padding: "var(--sp-3) 0", borderBottom: "1px solid var(--border-color)" }}>
        <div style={{ fontSize: "var(--fs-md)", color: COLORS.text, marginBottom: "var(--sp-2)" }}>
          {task.title || t("common.untitled")}
          {n > 0 && (
            <span className={`task-time has${stuck ? " stuck" : ""}`} style={{ marginLeft: "var(--sp-2)" }}>
              ↻{n}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
          <button
            type="button"
            className="modal-action-btn compact"
            disabled={stuck}
            title={stuck ? t("close.stuck") : undefined}
            onClick={() => act(() => api.moveTask(task.id, fromEpochDay(todayEd + 1)))}
          >
            {t("close.tomorrow")}
          </button>
          <button type="button" className="modal-action-btn compact" onClick={() => act(() => api.setSomeday(task.id))}>
            {t("close.someday")}
          </button>
          <button type="button" className="modal-action-btn compact danger" onClick={() => act(() => api.dropTask(task.id))}>
            {t("close.drop")}
          </button>
        </div>
        {stuck && (
          <div style={{ fontSize: "var(--fs-2xs)", color: "var(--text-secondary)", marginTop: "var(--sp-2)" }}>
            {t("close.stuck")}
          </div>
        )}
      </div>
    );
  };

  // Портал: иначе диалог наследует capitalize/жирность заголовка дня и его клики.
  return createPortal(
    <div
      className="modal-overlay"
      onClick={() => void dismiss()}
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
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          padding: "var(--sp-6)",
          width: 420,
          maxWidth: "92vw",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: COLORS.text, marginBottom: "var(--sp-3)" }}>
          {t("close.button")}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {open.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--fs-sm)", padding: "var(--sp-2) 0" }}>
              {t("close.empty")}
            </div>
          ) : (
            open.map(row)
          )}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("close.note")}
          rows={3}
          style={{
            marginTop: "var(--sp-4)",
            width: "100%",
            resize: "none",
            font: "inherit",
            fontSize: "var(--fs-sm)",
            padding: "var(--sp-2)",
            color: "var(--text-primary)",
            background: "transparent",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
          }}
        />
        <button
          type="button"
          className="modal-action-btn primary"
          disabled={!loaded}
          autoFocus
          onClick={async () => {
            await saveDay(true);
            onClose();
          }}
          style={{ marginTop: "var(--sp-4)" }}
        >
          {t("close.button")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
