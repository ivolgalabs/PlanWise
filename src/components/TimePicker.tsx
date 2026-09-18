import { useEffect, useState } from "react";
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
  // Пустая строка («УДАЛИТЬ» в системных часах) — снимаем значение.
  const pickTime = (t: string) => {
    if (!t) {
      onChange(null);
      return;
    }
    const [hh, mm] = t.split(":").map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) onChange(hh * 60 + mm);
  };
  // Длительность/выезд — своё значение ЧЕРЕЗ КОЛИЧЕСТВО (не время суток):
  // системные селекты «часы» и «минуты» (на Android открывают системный
  // барабан выбора). 0 часов 0 минут = снять значение (null).

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
          value={value !== null ? formatMinutes(value) ?? "" : ""}
          onChange={(e) => pickTime(e.target.value)}
          onInput={(e) => pickTime(e.currentTarget.value)}
          // Некоторые WebView-сборки коммитят значение только при закрытии
          // пикера — ловим и blur (применение идемпотентно, повтор не вредит).
          onBlur={(e) => pickTime(e.currentTarget.value)}
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
            {onChangeTravel && <DurationSelect value={travelTime ?? null} onChange={onChangeTravel} />}
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
            {onChangeDuration && <DurationSelect value={durationMinutes ?? null} onChange={onChangeDuration} />}
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
        onClick={() => setEditing(true)}
        style={{
          ...badgeStyle(value !== null, large, compact, conflict),
          cursor: "pointer",
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

      {editing && (
        /* Меню — модалкой ПО ЦЕНТРУ (одинаково на телефоне и десктопе):
           не привязано к кнопке слева, не обрезается контейнером и не
           выходит за край экрана. Клик по подложке закрывает. */
        <div style={overlayStyle} onClick={() => setEditing(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            {menu}
          </div>
        </div>
      )}
    </div>
  );
}

/** Числовые поля «ч» и «мин» для ввода КОЛИЧЕСТВА времени (длительность,
 *  выезд, напоминание): на таче — цифровая клавиатура. Значение применяется
 *  ТОЛЬКО по подтверждению (Enter или кнопка «ОК») — пока печатаешь число,
 *  ничего не меняется (раньше каждая цифра сразу коммитила значение, а в
 *  настройках напоминаний каждая цифра добавляла отдельный интервал).
 *  Без жёсткого потолка: maxHours — верхняя граница поля «часы» (по умолчанию
 *  168 ч = 7 суток). 0 ч 0 мин = снять значение (null). Переиспользуется
 *  в пикере и в карточке/настройках. */
export function DurationSelect({
  value,
  onChange,
  maxHours = 168,
}: {
  value: number | null;
  onChange: (m: number | null) => void;
  maxHours?: number;
}) {
  // Локальные строки полей: пока пользователь печатает, поле не «прыгает»
  // (контролируемое число с onChange-коммитом затирало бы ввод).
  const [hStr, setHStr] = useState<string>(() =>
    value != null && value > 0 ? String(Math.floor(value / 60)) : "",
  );
  const [mStr, setMStr] = useState<string>(() =>
    value != null && value > 0 ? String(value % 60) : "",
  );
  // Внешнее изменение (пресет, сброс) — синхронизируем поля.
  useEffect(() => {
    setHStr(value != null && value > 0 ? String(Math.floor(value / 60)) : "");
    setMStr(value != null && value > 0 ? String(value % 60) : "");
  }, [value]);

  // Применение — ТОЛЬКО по явному подтверждению (Enter или кнопка «ОК»):
  // пока печатаешь число, значение не меняется (раньше каждая цифра была
  // «подтверждением» — в настройках напоминаний каждая цифра добавляла
  // отдельный интервал). Пустое поле = 0.
  const commit = () => {
    const nh = hStr === "" ? 0 : parseInt(hStr, 10);
    const nm = mStr === "" ? 0 : parseInt(mStr, 10);
    if (Number.isNaN(nh) || Number.isNaN(nm)) return;
    const hh = Math.max(0, Math.min(maxHours, nh));
    const mm = Math.max(0, Math.min(59, nm));
    onChange(hh === 0 && mm === 0 ? null : hh * 60 + mm);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commit();
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={maxHours}
        value={hStr}
        onChange={(e) => setHStr(e.target.value)}
        onKeyDown={onKey}
        style={numStyle}
        title={`Часы (до ${maxHours})`}
      />
      <span style={unitStyle}>ч</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={mStr}
        onChange={(e) => setMStr(e.target.value)}
        onKeyDown={onKey}
        style={numStyle}
        title="Минуты"
      />
      <span style={unitStyle}>мин</span>
      <button
        type="button"
        onClick={commit}
        style={okBtnStyle}
        title="Применить значение"
      >
        ОК
      </button>
    </div>
  );
}

/** Подпись длительности: 30 мин / 1 ч / 1 ч 15 мин / 2 ч. */
function fmtDur(v: number): string {
  if (v < 60) return `${v} мин`;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

const pickerStyle: React.CSSProperties = { position: "relative", display: "inline-flex" };
function badgeStyle(hasTime: boolean, large = false, compact = false, conflict = false): React.CSSProperties {
  return {
    fontSize: large ? "var(--fs-sm)" : "var(--fs-2xs)",
    // Наложение по времени — красное время, чтобы конфликт был заметен.
    color: conflict ? "var(--danger)" : hasTime ? "var(--accent-text)" : COLORS.muted,
    background: conflict
      ? "color-mix(in srgb, var(--danger) 14%, transparent)"
      : hasTime
        ? accentTint(0.1)
        : "transparent",
    // Время не задано — пунктирная рамка показывает, что бейдж кликабелен
    // (сплошная выглядела бы как выбранное). В компактной сетке не добавляем —
    // там рамки у каждой строки шумели бы.
    border: !compact && !hasTime ? "1px dashed var(--border-color)" : undefined,
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
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 300,
  background: "var(--overlay)",
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
    border: `1px solid ${active ? COLORS.accent : "var(--border-color)"}`,
    background: active ? accentTint(0.1) : "transparent",
    color: active ? COLORS.accent : COLORS.text, borderRadius: "var(--radius-sm)",
  };
}
const timeInputStyle: React.CSSProperties = {
  width: "100%", fontSize: "var(--fs-md)", padding: "6px 8px",
  border: `1px solid var(--border-color)`, borderRadius: "var(--radius-sm)",
  background: "transparent", color: COLORS.text, outline: "none",
};
// Числовые поля «ч»/«мин» в DurationSelect: компактные, по центру цифры.
const numStyle: React.CSSProperties = {
  width: 54, fontSize: "var(--fs-sm)", padding: "4px 2px",
  border: `1px solid var(--border-color)`, borderRadius: "var(--radius-sm)",
  background: "transparent", color: COLORS.text, outline: "none",
  textAlign: "center",
};
const unitStyle: React.CSSProperties = {
  fontSize: "var(--fs-2xs)", color: COLORS.muted, marginRight: 2,
};
// Кнопка «ОК» в DurationSelect: явное подтверждение введённого ч/мин.
const okBtnStyle: React.CSSProperties = {
  fontSize: "var(--fs-2xs)",
  padding: "4px 8px",
  cursor: "pointer",
  border: `1px solid ${COLORS.accent}`,
  background: accentTint(0.1),
  color: "var(--accent-text)",
  borderRadius: "var(--radius-sm)",
  fontWeight: 600,
};
const submitStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: "var(--sp-3)",
  fontSize: "var(--fs-xs)", padding: "8px 10px", cursor: "pointer",
  border: `1px solid ${COLORS.accent}`, background: COLORS.accent, color: "var(--text-on-accent)",
  borderRadius: "var(--radius-md)",
};
