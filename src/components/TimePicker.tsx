import { useState } from "react";
import { COLORS, accentTint } from "../theme";
import { formatMinutes } from "../date";
import { useStore } from "../store";
import { useMediaQuery } from "../useMediaQuery";
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
  /** Наложение по времени с другой задачей: бейдж времени подсвечивается
   *  красным, чтобы конфликт был заметен. */
  conflict?: boolean;
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
  conflict = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const timePresets = useStore((s) => s.timePresets);
  // Общий listener на запрос (см. useMediaQuery) — тач-раскладка селектов.
  const isTouch = useMediaQuery("(pointer: coarse), (max-width: 560px)");

  // «Своё время» из системных часов: "HH:MM" → минуты, применяем сразу.
  const pickTime = (t: string) => {
    if (!t) return;
    const [hh, mm] = t.split(":").map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) onChange(hh * 60 + mm);
  };
  // Длительность/выезд — своё значение ЧЕРЕЗ КОЛИЧЕСТВО (не время суток):
  // системные селекты «часы» и «минуты» (на Android открывают системный
  // барабан выбора). 0 часов 0 минут = снять значение (null).
  const durationSel = (
    value: number | null,
    apply: ((m: number | null) => void) | undefined,
    maxHours: number,
  ) => {
    if (!apply) return null;
    return <DurationSelect value={value} onChange={apply} maxHours={maxHours} />;
  };

  // Меню (общее для модалки и popup). На мобиле кнопка «Готово» закрывает —
  // значения применяются сразу при выборе, как и раньше. Все кнопки с
  // type="button": меню живёт внутри <form> (окно «Новая задача»), иначе
  // клик по пресету сохранял бы форму (карточка «сохранялась» сама).
  const menu = (
    <>
      <button
        type="button"
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
              type="button"
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
      {/* Выезд заранее (время в пути): пресеты + своё значение часами и
          минутами (системные селекты — количество, не время суток). */}
      {onChangeTravel && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <div style={labelStyle}>Выехать заранее</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", alignItems: "center" }}>
            {[null, 15, 30, 45, 60, 90].map((v) => (
              <button
                key={v ?? 0}
                type="button"
                onClick={() => onChangeTravel(v)}
                style={presetBtn(travelTime === v)}
              >
                {v === null ? "—" : `${v} мин`}
              </button>
            ))}
            {durationSel(travelTime ?? null, onChangeTravel, 12)}
          </div>
        </div>
      )}
      {/* Длительность выполнения: пресеты + своё значение часами/минутами. */}
      {onChangeDuration && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <div style={labelStyle}>Длительность</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", alignItems: "center" }}>
            {[null, 30, 60, 90, 120, 180].map((v) => (
              <button
                key={v ?? 0}
                type="button"
                onClick={() => onChangeDuration(v)}
                style={presetBtn(durationMinutes === v)}
              >
                {v === null ? "—" : fmtDur(v)}
              </button>
            ))}
            {durationSel(durationMinutes ?? null, onChangeDuration, 12)}
          </div>
        </div>
      )}
      {isTouch && (
        <button
          type="button"
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
        type="button"
        onClick={() => setEditing((v) => !v)}
        style={{
          ...badgeStyle(value !== null, large, compact, conflict),
          cursor: "pointer",
          border: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-3)",
        }}
        title={conflict ? "Время пересекается с другой задачей" : "Изменить время"}
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

/** Системные селекты «часы» + «минуты» для ввода КОЛИЧЕСТВА времени
 *  (длительность, выезд, напоминание): на Android открывают системный барабан
 *  выбора. 0 часов 0 минут = снять значение (null). Переиспользуется в пикере
 *  и в карточке/настройках. */
export function DurationSelect({
  value,
  onChange,
  maxHours = 12,
}: {
  value: number | null;
  onChange: (m: number | null) => void;
  maxHours?: number;
}) {
  const h = value != null ? Math.floor(value / 60) : 0;
  const m = value != null ? value % 60 : 0;
  const set = (nh: number, nm: number) => {
    onChange(nh === 0 && nm === 0 ? null : nh * 60 + nm);
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <select
        value={h}
        onChange={(e) => set(Number(e.target.value), m)}
        style={selStyle}
        title="Часы"
      >
        {Array.from({ length: maxHours + 1 }, (_, i) => (
          <option key={i} value={i}>
            {i} ч
          </option>
        ))}
      </select>
      <select
        value={m}
        onChange={(e) => set(h, Number(e.target.value))}
        style={selStyle}
        title="Минуты"
      >
        {Array.from({ length: 12 }, (_, i) => i * 5).map((v) => (
          <option key={v} value={v}>
            {v === 0 ? "0 мин" : `${v} мин`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Подпись длительности: 30 мин / 1 ч / 1.5 ч / 2 ч. */
function fmtDur(v: number): string {
  if (v < 60) return `${v} мин`;
  return v % 60 === 0 ? `${v / 60} ч` : `${Math.round((v / 60) * 2) / 2} ч`;
}

const pickerStyle: React.CSSProperties = { position: "relative", display: "inline-flex" };
function badgeStyle(hasTime: boolean, large = false, compact = false, conflict = false): React.CSSProperties {
  return {
    fontSize: large ? "var(--fs-sm)" : "var(--fs-2xs)",
    // Наложение по времени — красное время, чтобы конфликт был заметен.
    color: conflict ? "#e05252" : hasTime ? COLORS.accent : COLORS.muted,
    background: conflict
      ? "rgba(224,82,82,0.14)"
      : hasTime
        ? accentTint(0.1)
        : "transparent",
    padding: large ? "4px 10px" : "1px 6px",
    borderRadius: "var(--radius-md)",
    minHeight: compact ? 26 : undefined,
    alignItems: compact ? "center" : undefined,
    fontWeight: conflict ? 700 : undefined,
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
const selStyle: React.CSSProperties = {
  fontSize: "var(--fs-2xs)", padding: "3px 4px",
  border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-sm)",
  background: "transparent", color: COLORS.text, outline: "none",
  maxWidth: 84,
};
const submitStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: "var(--sp-3)",
  fontSize: "var(--fs-xs)", padding: "8px 10px", cursor: "pointer",
  border: `1px solid ${COLORS.accent}`, background: COLORS.accent, color: "#fff",
  borderRadius: "var(--radius-md)",
};
