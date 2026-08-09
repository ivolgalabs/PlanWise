import { useEffect, useState } from "react";
import { COLORS, accentTint } from "../theme";
import { formatMinutes } from "../date";
import { useStore } from "../store";
import { Icon } from "./Icon";

interface Props {
  /** Текущее время в минутах, или null = «в течение дня». */
  value: number | null;
  /** onChange(minutes | null). null = «в течение дня». */
  onChange: (m: number | null) => void;
  /** Компактный режим (сетка недели): без времени — только иконка часов. */
  compact?: boolean;
  /** Крупный режим (модалка месяца): заметный чип, как остальные поля. */
  large?: boolean;
  /** Время в пути (мин) — «выехать заранее», уведомление «Пора выезжать». */
  travelTime?: number | null;
  onChangeTravel?: (m: number | null) => void;
  /** Длительность выполнения (мин) — показ «09:00–10:30». */
  durationMinutes?: number | null;
  onChangeDuration?: (m: number | null) => void;
}

/**
 * Выбор времени — системными окнами вместо самодельных колёсиков:
 *  - Время начала: нативный <input type="time"> (на Android открывает системные
 *    часы, на десктопе — стандартное поле), плюс быстрые пресеты-кнопки.
 *  - «Выехать заранее» / «Длительность»: нативный <input type="number"> —
 *    можно ввести ЛЮБОЕ своё значение (минуты), пресеты остаются как быстрые.
 *  - Список быстрых пресетов времени — пользовательский, из настроек
 *    (store.timePresets).
 * На мобильном меню открывается модалкой по центру экрана (в неделе/поиске не
 * вылезает за края), на десктопе — popup-меню с ограничением по высоте.
 */
export function TimePicker({
  value,
  onChange,
  compact = false,
  large = false,
  travelTime,
  onChangeTravel,
  durationMinutes,
  onChangeDuration,
}: Props) {
  const [editing, setEditing] = useState(false);
  const { timePresets } = useStore();
  const [isTouch, setTouch] = useState(
    () => window.matchMedia("(pointer: coarse), (max-width: 560px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 560px)");
    const handler = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // «Своё время» из системных часов: "HH:MM" → минуты, применяем сразу.
  const pickTime = (t: string) => {
    if (!t) return;
    const [hh, mm] = t.split(":").map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) onChange(hh * 60 + mm);
  };
  // Длительность/выезд системными часами: "ЧЧ:ММ" трактуется как длительность
  // (01:30 = 90 минут); пустое поле = снять значение (null).
  const applyMinutes = (t: string, apply: ((m: number | null) => void) | undefined) => {
    if (!apply) return;
    if (!t) return apply(null);
    const [hh, mm] = t.split(":").map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm) && hh * 60 + mm <= 1440) {
      apply(hh * 60 + mm);
    }
  };

  // Меню (общее для модалки и popup). На мобиле кнопка «Готово» закрывает —
  // значения применяются сразу при выборе, как и раньше.
  const menu = (
    <>
      <button
        style={presetBtn(value === null)}
        onClick={() => { onChange(null); setEditing(false); }}
        title="Без привязки ко времени"
      >
        в течение дня
      </button>
      {timePresets.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", margin: "var(--sp-2) 0" }}>
          {timePresets.map((m) => (
            <button
              key={m}
              style={presetBtn(value === m)}
              onClick={() => { onChange(m); setEditing(false); }}
            >
              {formatMinutes(m)}
            </button>
          ))}
        </div>
      )}
      {/* Нативное системное окно выбора времени (Android — системные часы). */}
      <div style={{ marginTop: "var(--sp-2)" }}>
        <div style={labelStyle}>Своё время</div>
        <input
          type="time"
          value={value !== null ? toHHMM(value) : ""}
          onChange={(e) => pickTime(e.target.value)}
          style={timeInputStyle}
          title="Выбрать время системными часами"
        />
      </div>
      {/* Выезд заранее (время в пути): пресеты + своё значение системными
          часами (интерпретируется как длительность: 01:30 = 90 минут). */}
      {onChangeTravel && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <div style={labelStyle}>Выехать заранее</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", alignItems: "center" }}>
            {[null, 15, 30, 45, 60, 90].map((v) => (
              <button
                key={v ?? 0}
                onClick={() => onChangeTravel(v)}
                style={presetBtn(travelTime === v)}
              >
                {v === null ? "—" : `${v} мин`}
              </button>
            ))}
            <input
              type="time"
              value={travelTime != null && travelTime > 0 ? toHHMM(travelTime) : ""}
              onChange={(e) => applyMinutes(e.target.value, onChangeTravel)}
              style={numInputStyle}
              title="Своё значение — системные часы (01:30 = 90 мин)"
            />
          </div>
        </div>
      )}
      {/* Длительность выполнения: пресеты + своё значение системными часами. */}
      {onChangeDuration && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <div style={labelStyle}>Длительность</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", alignItems: "center" }}>
            {[null, 30, 60, 90, 120, 180].map((v) => (
              <button
                key={v ?? 0}
                onClick={() => onChangeDuration(v)}
                style={presetBtn(durationMinutes === v)}
              >
                {v === null ? "—" : fmtDur(v)}
              </button>
            ))}
            <input
              type="time"
              value={durationMinutes != null && durationMinutes > 0 ? toHHMM(durationMinutes) : ""}
              onChange={(e) => applyMinutes(e.target.value, onChangeDuration)}
              style={numInputStyle}
              title="Своё значение — системные часы (01:30 = 90 мин)"
            />
          </div>
        </div>
      )}
      {isTouch && (
        <button
          onClick={() => setEditing(false)}
          style={submitStyle}
          title="Закрыть"
        >
          Готово
        </button>
      )}
    </>
  );

  return (
    <div style={pickerStyle}>
      <button
        onClick={() => setEditing((v) => !v)}
        style={{
          ...badgeStyle(value !== null, large, compact),
          cursor: "pointer",
          border: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-3)",
        }}
        title="Изменить время"
      >
        {!compact && <Icon name="clock" size={large ? 16 : 13} />}
        {value !== null
          ? formatMinutes(value)
          : compact
            ? "в теч. дня"
            : "в течение дня"}
      </button>

      {editing &&
        (isTouch ? (
          /* Модалка по центру экрана на мобильном: не зависит от положения
             кнопки, не вылезает за края (в неделе/поиске меню обрезалось
             контейнером со скроллом). */
          <div style={overlayStyle} onClick={() => setEditing(false)}>
            <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
              {menu}
            </div>
          </div>
        ) : (
          <div style={menuStyle}>{menu}</div>
        ))}
    </div>
  );
}

/** ЧЧ:ММ для value системного input type=time. */
function toHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Подпись длительности: 30 мин / 1 ч / 1.5 ч / 2 ч. */
function fmtDur(v: number): string {
  if (v < 60) return `${v} мин`;
  return v % 60 === 0 ? `${v / 60} ч` : `${Math.round((v / 60) * 2) / 2} ч`;
}

const pickerStyle: React.CSSProperties = { position: "relative", display: "inline-flex" };
function badgeStyle(hasTime: boolean, large = false, compact = false): React.CSSProperties {
  return {
    fontSize: large ? "var(--fs-sm)" : "var(--fs-2xs)",
    color: hasTime ? COLORS.accent : COLORS.muted,
    background: hasTime ? accentTint(0.1) : "transparent",
    padding: large ? "4px 10px" : "1px 6px",
    borderRadius: "var(--radius-md)",
    minHeight: compact ? 26 : undefined,
    alignItems: compact ? "center" : undefined,
  };
}
const labelStyle: React.CSSProperties = {
  fontSize: "var(--fs-2xs)",
  color: COLORS.muted,
  marginBottom: "var(--sp-1)",
};
const menuStyle: React.CSSProperties = {
  position: "absolute", right: 0, top: "100%", marginTop: 4,
  background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: "var(--radius-md)", padding: "var(--sp-2)",
  boxShadow: "var(--shadow-lg)", zIndex: 200, minWidth: 200,
  // Ограничение по высоте: длинное меню скроллится, а не уходит за экран.
  maxHeight: "min(70vh, 480px)", overflowY: "auto",
};
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 300,
  background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
};
const modalStyle: React.CSSProperties = {
  background: COLORS.card, borderRadius: "var(--radius-lg)",
  padding: "var(--sp-4)", boxShadow: "var(--shadow-lg)",
  width: "min(92vw, 360px)", maxHeight: "80vh", overflowY: "auto",
};
function presetBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: "var(--fs-2xs)", padding: "3px 6px", cursor: "pointer",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
    background: active ? accentTint(0.1) : "transparent",
    color: active ? COLORS.accent : COLORS.text, borderRadius: "var(--radius-sm)",
  };
}
const timeInputStyle: React.CSSProperties = {
  width: "100%", fontSize: "var(--fs-md)", padding: "6px 8px",
  border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-sm)",
  background: "transparent", color: COLORS.text, outline: "none",
};
const numInputStyle: React.CSSProperties = {
  width: 84, fontSize: "var(--fs-2xs)", padding: "3px 6px",
  border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-sm)",
  background: "transparent", color: COLORS.text, outline: "none",
};
const submitStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: "var(--sp-3)",
  fontSize: "var(--fs-xs)", padding: "8px 10px", cursor: "pointer",
  border: `1px solid ${COLORS.accent}`, background: COLORS.accent, color: "#fff",
  borderRadius: "var(--radius-md)",
};
