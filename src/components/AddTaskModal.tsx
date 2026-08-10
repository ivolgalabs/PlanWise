import { useEffect, useRef, useState } from "react";
import type { Subtask, Task } from "../api";
import { api, toEpochDay } from "../api";
import { useStore } from "../store";
import { COLORS, argbToHex } from "../theme";
import { TimePicker, DurationSelect } from "./TimePicker";
import { Icon } from "./Icon";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePickerModal } from "./DatePickerModal";

/** Уровни приоритета: 0 = не задан, 1 = низкий, 2 = средний, 3 = высокий. */
const PRIO = [
  { v: 0, label: "—", color: "" },
  { v: 1, label: "низкий", color: "#4caf50" },
  { v: 2, label: "средний", color: "#ffb300" },
  { v: 3, label: "высокий", color: "#e05252" },
];

/** Варианты «Уведомить»: по умолчанию (глобальные интервалы настроек),
 *  не уведомлять или своё значение — КОЛИЧЕСТВО времени до начала
 *  (селекты «часы»/«минуты», системный барабан). */
const NOTIFY_OPTS: { v: number; label: string }[] = [
  { v: -1, label: "По умолчанию (из настроек)" },
  { v: 0, label: "Не уведомлять" },
  { v: 5, label: "За 5 минут" },
  { v: 15, label: "За 15 минут" },
  { v: 30, label: "За 30 минут" },
  { v: 60, label: "За 1 час" },
  { v: 120, label: "За 2 часа" },
  { v: 180, label: "За 3 часа" },
  { v: 1440, label: "За 1 день" },
  { v: -2, label: "Своё значение…" },
];

interface FieldsProps {
  /** День, на который добавляется задача (для создания) или день задачи. */
  day: Date;
  /** Вызывается после успешного сохранения (родитель решает — закрыть). */
  onAdded: () => void;
  onCancel: () => void;
  /** Автофокус на поле названия (в модалке дня удобно, в месяце — нет). */
  autoFocus?: boolean;
  /** Редактирование существующей задачи: поля заполняются из неё,
   *  «Добавить» становится «Сохранить», появляются «Перенести» и «Удалить». */
  initial?: Task;
  /** Перечитать список задач после сохранения/удаления/переноса. */
  onChange?: () => void;
}

/**
 * Поля формы «Новая задача» (без оверлея): название, время (системные часы +
 * пресеты), приоритет, длительность/выезд (системные селекты ч/мин),
 * уведомление, категория, заметка и (при создании) подзадачи. Ошибка «время
 * занято» от Rust показывается в форме, окно не закрывается. Переиспользуется
 * в модалке дня/недели, в окне месяца и в карточке задачи (initial).
 */
export function TaskFormFields({
  day,
  onAdded,
  onCancel,
  autoFocus = false,
  initial,
  onChange,
}: FieldsProps) {
  const editing = initial !== undefined;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [time, setTime] = useState<number | null>(initial?.timeMinutes ?? null);
  const [priority, setPriority] = useState(initial?.difficulty ?? 0);
  const [duration, setDuration] = useState<number | null>(initial?.durationMinutes ?? null);
  const [travel, setTravel] = useState<number | null>(initial?.travelTime ?? null);
  const [color, setColor] = useState<string | null>(initial?.colorSetId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Своё уведомление: null = по умолчанию; select хранит -1 для «по умолчанию»,
  // -2 для «Своё значение…» (показывает системные часы).
  const [notify, setNotify] = useState<number | null>(initial?.notifyMinutes ?? null);
  const [customNotify, setCustomNotify] = useState(false);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // Подзадачи: при создании — тексты, которые сохранятся вместе с задачей;
  // при редактировании — реальные подзадачи задачи (чекбоксы, удаление,
  // добавление сразу).
  const [subs, setSubs] = useState<string[]>([]);
  const [newSub, setNewSub] = useState("");
  const [subItems, setSubItems] = useState<Subtask[]>([]);
  useEffect(() => {
    if (!editing || !initial) return;
    api.getSubtasks(initial.id).then(setSubItems).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);
  // Авто-выполнение: время в прошлом → задача выполнена; в будущем —
  // выполнение снимается (настройка «авто-выполнение»). Применяется только
  // если время реально изменилось в карточке.
  const { autoDonePastTime } = useStore();
  const { colorSets } = useStore();
  const sets = colorSets.filter((s) => s.id !== "cs-none");

  const notifySelectValue = () => {
    if (notify == null) return -1;
    if (NOTIFY_OPTS.some((o) => o.v === notify)) return notify;
    return -2; // своё значение, которого нет в списке
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setError("");
    const payload = {
      title: t,
      timeMinutes: time,
      difficulty: priority,
      durationMinutes: duration,
      travelTime: travel,
      colorSetId: color,
      notes,
      notifyMinutes: notify,
    };
    try {
      if (editing && initial) {
        await api.upsertTask({ ...initial, ...payload });
        // Авто-выполнение при смене времени (настройка): прошлое → выполнена,
        // будущее → выполнение снимается. Только если время изменилось.
        const timeChanged = initial.timeMinutes !== time;
        if (autoDonePastTime && timeChanged && time != null) {
          const now = new Date();
          const today = Math.floor(
            Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
          );
          const nowMin = now.getHours() * 60 + now.getMinutes();
          const past = toEpochDay(day) < today || (toEpochDay(day) === today && time <= nowMin);
          const future = toEpochDay(day) > today || (toEpochDay(day) === today && time > nowMin);
          if (past || future) {
            await api.upsertTask({ ...initial, ...payload, isDone: past });
          }
        }
        onChange?.();
      } else {
        // Новая задача + подзадачи (создаются с тем же текстом, что набрал
        // пользователь; пустые строки пропускаем).
        const created = await api.upsertTask({ ...payload, date: toEpochDay(day) });
        for (const s of subs) {
          const st = s.trim();
          if (st) await api.upsertSubtask({ taskId: created.id, title: st });
        }
      }
      onAdded();
    } catch (err) {
      // Rust не дал сохранить (время занято другой задачей) — показываем
      // сообщение, форма остаётся открытой.
      setError(typeof err === "string" ? err : "Не удалось сохранить задачу");
    }
  };

  const del = async () => {
    if (!initial) return;
    setConfirmDel(false);
    await api.deleteTask(initial.id);
    onChange?.();
    onAdded();
  };

  const addSub = () => {
    const s = newSub.trim();
    if (!s) return;
    setSubs((arr) => [...arr, s]);
    setNewSub("");
  };
  // Добавить подзадачу к существующей задаче прямо из карточки.
  const addSubItem = async () => {
    const s = newSub.trim();
    if (!s || !initial) return;
    await api.upsertSubtask({ taskId: initial.id, title: s });
    setNewSub("");
    setSubItems(await api.getSubtasks(initial.id));
  };

  const fieldRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--sp-2)",
    marginBottom: "var(--sp-3)",
    flexWrap: "wrap",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "var(--fs-sm)",
    color: COLORS.muted,
    minWidth: "var(--island-h)",
  };

  return (
    <form onSubmit={submit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        enterKeyHint="done"
        placeholder="Название задачи"
        autoFocus={autoFocus}
        style={{
          width: "100%",
          fontSize: "var(--fs-md)",
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: "var(--radius-md)",
          padding: "10px 12px",
          marginBottom: "var(--sp-4)",
          background: "transparent",
          color: COLORS.text,
          outline: "none",
        }}
      />

      {/* Время + длительность + выезд — одним пикером (системные часы/селекты). */}
      <div style={fieldRow}>
        <span style={labelStyle}>Время</span>
        <TimePicker
          value={time}
          onChange={setTime}
          travelTime={travel}
          onChangeTravel={setTravel}
          durationMinutes={duration}
          onChangeDuration={setDuration}
          large
        />
      </div>

      {/* Приоритет — явные кнопки с подписями. */}
      <div style={fieldRow}>
        <span style={labelStyle}>Приоритет</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
          {PRIO.map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => setPriority(p.v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                fontSize: "var(--fs-2xs)",
                padding: "4px 8px",
                cursor: "pointer",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${priority === p.v ? COLORS.accent : COLORS.cardBorder}`,
                background: priority === p.v ? "rgba(0,0,0,0.06)" : "transparent",
                color: COLORS.text,
              }}
              title={p.label}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: p.color || COLORS.muted,
                  display: "inline-block",
                }}
              />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Своё уведомление задачи: по умолчанию / не уведомлять / за N минут /
          своё значение системными часами. Подзадачи наследуют уведомление. */}
      <div style={fieldRow}>
        <span style={labelStyle}>Уведомить</span>
        <select
          value={notifySelectValue()}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v === -2) {
              setCustomNotify(true);
              return;
            }
            setCustomNotify(false);
            setNotify(v < 0 ? null : v);
          }}
          style={{
            fontSize: "var(--fs-sm)",
            padding: "6px 8px",
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: "var(--radius-md)",
            background: "transparent",
            color: COLORS.text,
            outline: "none",
            maxWidth: "100%",
          }}
        >
          {NOTIFY_OPTS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
        {customNotify && (
          /* Своё значение — КОЛИЧЕСТВО времени до начала (системные
             селекты «ч»/«мин»), а не время суток. */
          <DurationSelect value={notify != null && notify > 0 ? notify : null} onChange={setNotify} />
        )}
      </div>

      {/* Категория — свотчи с подписями. */}
      <div style={fieldRow}>
        <span style={labelStyle}>Цвет</span>
        <button
          type="button"
          onClick={() => setColor(null)}
          title="Без категории"
          className="chip-btn"
          style={{
            background: "transparent",
            border: `1px solid ${color === null ? COLORS.accent : COLORS.cardBorder}`,
            opacity: color === null ? 1 : 0.5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
          }}
        >
          <Icon name="close" size={12} />
        </button>
        {sets.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setColor(c.id)}
            title={c.name}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--sp-1)",
              padding: 4,
              background: "transparent",
              border: "none",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              opacity: color && color !== c.id ? 0.45 : 1,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: argbToHex(c.color),
                border: `2px solid ${color === c.id ? COLORS.accent : "transparent"}`,
              }}
            />
            <span
              style={{
                fontSize: "var(--fs-xs)",
                color: COLORS.muted,
                maxWidth: 48,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.name}
            </span>
          </button>
        ))}
      </div>

      {/* Заметка к задаче. */}
      <div style={fieldRow}>
        <span style={labelStyle}>Заметка</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Заметка…"
          rows={2}
          style={{
            flex: 1,
            minWidth: 180,
            fontSize: "var(--fs-sm)",
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: "var(--radius-md)",
            padding: "6px 10px",
            background: "transparent",
            color: COLORS.text,
            outline: "none",
            resize: "vertical",
          }}
        />
      </div>

      {/* Подзадачи: при создании — добавляются сразу (шестерёнка); в карточке
          существующей задачи — полный список с чекбоксами, удалением и полем. */}
      <div style={{ ...fieldRow, alignItems: "flex-start" }}>
        <span style={labelStyle}>Подзадачи</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          {editing
            ? subItems.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    fontSize: "var(--fs-sm)",
                    color: COLORS.text,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={s.isDone}
                    onChange={async () => {
                      await api.upsertSubtask({ ...s, isDone: !s.isDone });
                      setSubItems(await api.getSubtasks(s.taskId));
                    }}
                    style={{ margin: 0 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textDecoration: s.isDone ? "line-through" : "none",
                      color: s.isDone ? COLORS.muted : COLORS.text,
                    }}
                  >
                    {s.title}
                  </span>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={async () => {
                      await api.deleteSubtask(s.id);
                      setSubItems(await api.getSubtasks(s.taskId));
                    }}
                    title="Удалить подзадачу"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))
            : subs.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    fontSize: "var(--fs-sm)",
                    color: COLORS.text,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.muted, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s}
                  </span>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => setSubs((arr) => arr.filter((_, j) => j !== i))}
                    title="Убрать"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
          <div style={{ display: "flex", gap: "var(--sp-1)", alignItems: "center" }}>
            <input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (editing) addSubItem();
                  else addSub();
                }
              }}
              placeholder="+ подзадача"
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "var(--fs-sm)",
                border: `1px dashed ${COLORS.cardBorder}`,
                borderRadius: "var(--radius-md)",
                padding: "6px 10px",
                background: "transparent",
                color: COLORS.text,
                outline: "none",
              }}
            />
            <button
              type="button"
              className="modal-action-btn"
              onClick={() => (editing ? addSubItem() : addSub())}
              title="Добавить подзадачу"
              style={{
                flexShrink: 0,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: "var(--fs-sm)",
                borderRadius: "var(--radius-md)",
                border: "none",
                background: COLORS.accent,
                color: "#fff",
              }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: "var(--fs-sm)",
            color: "#d9534f",
            marginBottom: "var(--sp-3)",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        {editing && (
          <>
            <button
              type="button"
              className="modal-action-btn"
              onClick={() => setMoveOpen(true)}
              title="Перенести на другой день"
              style={{
                flexShrink: 0,
                padding: "var(--sp-3) var(--sp-4)",
                cursor: "pointer",
                fontSize: "var(--fs-sm)",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${COLORS.cardBorder}`,
                background: "transparent",
                color: COLORS.text,
              }}
            >
              <Icon name="calendarCheck" size={13} /> Перенести
            </button>
            <button
              type="button"
              className="modal-action-btn"
              onClick={() => setConfirmDel(true)}
              title="Удалить задачу"
              style={{
                flexShrink: 0,
                padding: "var(--sp-3) var(--sp-4)",
                cursor: "pointer",
                fontSize: "var(--fs-sm)",
                borderRadius: "var(--radius-md)",
                border: `1px solid rgba(224,82,82,0.6)`,
                background: "transparent",
                color: "#e05252",
              }}
            >
              <Icon name="close" size={13} /> Удалить
            </button>
          </>
        )}
        <button
          type="submit"
          className="modal-action-btn"
          style={{
            flex: 1,
            padding: "var(--sp-3) var(--sp-4)",
            cursor: "pointer",
            fontSize: "var(--fs-sm)",
            borderRadius: "var(--radius-md)",
            border: "none",
            background: COLORS.accent,
            color: "#fff",
          }}
        >
          {editing ? "Сохранить" : "Добавить"}
        </button>
        <button
          type="button"
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

      {confirmDel && (
        <ConfirmDialog
          title={`Удалить задачу «${title.trim() || "без названия"}»?`}
          confirmLabel="Удалить"
          onConfirm={del}
          onCancel={() => setConfirmDel(false)}
        />
      )}
      {moveOpen && initial && (
        <DatePickerModal
          tasks={[]}
          onPick={async (d) => {
            await api.moveTask(initial.id, d);
            setMoveOpen(false);
            onChange?.();
            onAdded();
          }}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </form>
  );
}

/** Модалка «Новая задача» — оверлей + форма (день/неделя/месяц). При initial —
 *  карточка задачи (редактирование): открывается по нажатию на задачу. */
export function AddTaskModal({
  day,
  onClose,
  onChange,
  initial,
}: {
  day: Date;
  onClose: () => void;
  onChange: () => void;
  /** Редактирование существующей задачи (карточка). */
  initial?: Task;
}) {
  const editing = initial !== undefined;
  // Защита от «клика-призрака»: карточка открылась по тапу на задачу, а
  // отпускание пальца попало на оверлей (position:fixed) — такой клик не
  // должен сразу закрывать только что открытое окно.
  const openedAt = useRef(Date.now());
  // Задача «Когда-нибудь» не привязана ко дню — заголовок без даты.
  const head = editing && initial?.someday
    ? "Когда-нибудь"
    : day.toLocaleDateString("ru", { day: "numeric", month: "long", weekday: "long" });
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (Date.now() - openedAt.current < 300) return;
        onClose();
      }}
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
          padding: "var(--sp-8)",
          width: 460,
          maxWidth: "92vw",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div
          style={{
            fontSize: "var(--fs-lg)",
            fontWeight: 700,
            color: COLORS.text,
            marginBottom: "var(--sp-5)",
            textTransform: "capitalize",
          }}
        >
          {head}
        </div>
        <TaskFormFields
          day={day}
          initial={initial}
          autoFocus={!editing}
          onChange={onChange}
          onAdded={() => {
            onChange();
            onClose();
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
