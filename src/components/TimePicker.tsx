import { useEffect, useRef, useState } from "react";
import { COLORS, accentTint } from "../theme";
import { formatMinutes } from "../date";
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

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** Компактный time-picker: «в течение дня» / колёсики ЧЧ:ММ / пресеты.
 *  Вместо текстового ввода — два прокручиваемых списка (колёсика): часы
 *  и минуты, удобно пальцем на мобильном, без клавиатуры. */
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
  // Колёсики: текущие выбранные час/минуты (из value или ближайшие к сейчас).
  const curH = value !== null ? Math.floor(value / 60) : new Date().getHours();
  const curM = value !== null ? value % 60 : new Date().getMinutes();
  const [h, setH] = useState(curH);
  const [m, setM] = useState(curM);
  // Синхронизируем колёсики при открытии/смене внешнего value.
  useEffect(() => {
    setH(value !== null ? Math.floor(value / 60) : new Date().getHours());
    setM(value !== null ? value % 60 : new Date().getMinutes());
  }, [value, editing]);

  const presets = [
    { label: "09:00", m: 9 * 60 },
    { label: "12:00", m: 12 * 60 },
    { label: "15:00", m: 15 * 60 },
    { label: "18:00", m: 18 * 60 },
    { label: "21:00", m: 21 * 60 },
  ];

  // Применяем время сразу при выборе значения в колёсике (а не по «ок»):
  // иначе при быстрых кликах state h/m ещё не обновился, и «ок» применил бы
  // старые значения. «ок» просто закрывает меню.
  const pickHour = (hh: number) => {
    const mm = m;
    setH(hh);
    onChange(hh * 60 + mm);
  };
  const pickMinute = (mm: number) => {
    const hh = h;
    setM(mm);
    onChange(hh * 60 + mm);
  };

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
        {/* В компактном режиме — только текст (иконка не влезает в правый ряд
            задачи на мобильном). */}
        {!compact && <Icon name="clock" size={large ? 16 : 13} />}
        {/* В компактном режиме без времени — короткая подпись «в теч. дня»,
            чтобы справа от задачи было видно, что время не задано. */}
        {value !== null
          ? formatMinutes(value)
          : compact
            ? "в теч. дня"
            : "в течение дня"}
      </button>

      {editing && (
        <div style={menuStyle}>
          <button style={presetBtn(value === null)} onClick={() => { onChange(null); setEditing(false); }}>
            в течение дня
          </button>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", margin: "var(--sp-2) 0" }}>
            {presets.map((p) => (
              <button key={p.m} style={presetBtn(value === p.m)} onClick={() => { onChange(p.m); setEditing(false); }}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Колёсики часов и минут: прокручиваемые списки, активное значение
              подсвечено; тап по значению выбирает. */}
          <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-2)" }}>
            <Wheel
              values={HOURS}
              format={(v) => String(v).padStart(2, "0")}
              selected={h}
              onSelect={pickHour}
            />
            <span style={{ alignSelf: "center", fontSize: "var(--fs-lg)", color: COLORS.muted }}>:</span>
            <Wheel
              values={MINUTES}
              format={(v) => String(v).padStart(2, "0")}
              selected={Math.floor(m / 5) * 5}
              onSelect={pickMinute}
            />
            <button
              onClick={() => setEditing(false)}
              style={submitStyle}
              title="Закрыть"
            >
              ок
            </button>
          </div>
          {/* Выезд заранее (время в пути) и длительность — только когда
              коллбэки переданы (в карточке задачи). Пресеты — кнопки. */}
          {onChangeTravel && (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <div style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, marginBottom: "var(--sp-1)" }}>
                Выехать заранее
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                {[null, 15, 30, 45, 60, 90].map((v) => (
                  <button
                    key={v ?? 0}
                    onClick={() => onChangeTravel?.(v)}
                    style={presetBtn(travelTime === v)}
                  >
                    {v === null ? "—" : `${v} мин`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {onChangeDuration && (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <div style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, marginBottom: "var(--sp-1)" }}>
                Длительность
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                {[null, 30, 60, 90, 120, 180].map((v) => (
                  <button
                    key={v ?? 0}
                    onClick={() => onChangeDuration?.(v)}
                    style={presetBtn(durationMinutes === v)}
                  >
                    {v === null
                      ? "—"
                      : v < 60
                        ? `${v} мин`
                        : v === 90
                          ? "1.5 ч"
                          : `${v / 60} ч`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Прокручиваемое колёсико выбора: список значений, активное — подсвечено. */
function Wheel({
  values,
  format,
  selected,
  onSelect,
}: {
  values: number[];
  format: (v: number) => string;
  selected: number;
  onSelect: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // При открытии/смене выбора прокручиваем к активному значению.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = values.indexOf(selected);
    if (idx < 0) return;
    const item = el.children[idx] as HTMLElement | undefined;
    if (item) el.scrollTop = item.offsetTop - el.clientHeight / 2 + item.clientHeight / 2;
  }, [selected, values]);
  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        maxHeight: 150,
        scrollbarWidth: "none",
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: "var(--radius-md)",
        padding: "0 2px",
      }}
    >
      {values.map((v) => {
        const active = v === selected;
        return (
          <button
            key={v}
            onClick={() => onSelect(v)}
            style={{
              border: "none",
              background: active ? accentTint(0.15) : "transparent",
              color: active ? COLORS.accent : COLORS.text,
              fontWeight: active ? 700 : 400,
              fontSize: "var(--fs-md)",
              padding: "8px 10px",
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
              minWidth: 44,
            }}
          >
            {format(v)}
          </button>
        );
      })}
    </div>
  );
}

const pickerStyle: React.CSSProperties = { position: "relative", display: "inline-flex" };
function badgeStyle(hasTime: boolean, large = false, compact = false): React.CSSProperties {
  return {
    fontSize: large ? "var(--fs-sm)" : "var(--fs-2xs)",
    color: hasTime ? COLORS.accent : COLORS.muted,
    background: hasTime ? accentTint(0.1) : "transparent",
    padding: large ? "4px 10px" : "1px 6px",
    borderRadius: "var(--radius-md)",
    // Компактный бейдж (правый ряд задачи на мобильном) — высота как у чипов
    // действий, чтобы по нему удобно попадать пальцем.
    minHeight: compact ? 26 : undefined,
    alignItems: compact ? "center" : undefined,
  };
}
const menuStyle: React.CSSProperties = {
  position: "absolute", right: 0, top: "100%", marginTop: 4,
  background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: "var(--radius-md)", padding: "var(--sp-2)",
  boxShadow: "var(--shadow-lg)", zIndex: 200, minWidth: 180,
};
function presetBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: "var(--fs-2xs)", padding: "3px 6px", cursor: "pointer",
    border: `1px solid ${active ? COLORS.accent : COLORS.cardBorder}`,
    background: active ? accentTint(0.1) : "transparent",
    color: active ? COLORS.accent : COLORS.text, borderRadius: "var(--radius-sm)",
  };
}
const submitStyle: React.CSSProperties = {
  alignSelf: "center", fontSize: "var(--fs-xs)", padding: "6px 10px", cursor: "pointer",
  border: `1px solid ${COLORS.accent}`, background: COLORS.accent, color: "#fff",
  borderRadius: "var(--radius-md)",
};
