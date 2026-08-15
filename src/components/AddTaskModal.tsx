import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Attachment, Subtask, Task } from "../api";
import { api, toEpochDay } from "../api";
import { useStore } from "../store";
import { COLORS, argbToHex } from "../theme";
import { TimePicker, DurationSelect } from "./TimePicker";
import { Icon } from "./Icon";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePickerModal } from "./DatePickerModal";

/** Уровни приоритета: 0 = не задан, 1 = низкий, 2 = средний, 3 = высокий.
 *  Цвета — глобальные CSS-переменные приоритета (themes.css). */
const PRIO = [
  { v: 0, label: "—", color: "" },
  { v: 1, label: "низкий", color: "var(--prio-low)" },
  { v: 2, label: "средний", color: "var(--prio-med)" },
  { v: 3, label: "высокий", color: "var(--prio-high)" },
];

/** Лимит вложения (совпадает с Rust: 25 МБ на команду) — отсекаем файлы
 *  сразу при выборе, чтобы не читать в base64 то, что всё равно не сохранится. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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
  /** Режим шаблона задачи: полная карточка (время, приоритет, категория,
   *  заметка, подзадачи), но без файлов/переноса/удаления — сохранение
   *  отдаёт данные через onCollect вместо записи задачи. */
  templateMode?: boolean;
  /** Начальные подзадачи (для шаблона: просто тексты, как при создании). */
  initialSubs?: string[];
  /** Вместо сохранения задачи — отдать собранные данные наружу (шаблон). */
  onCollect?: (data: {
    title: string;
    timeMinutes: number | null;
    difficulty: number;
    durationMinutes: number | null;
    travelTime: number | null;
    notifyMinutes: number | null;
    colorSetId: string | null;
    notes: string;
    subs: string[];
  }) => void;
}

/**
 * Поля формы «Новая задача» (без оверлея): название, время (системные часы +
 * пресеты), приоритет, длительность/выезд (системные селекты ч/мин),
 * уведомление, категория, заметка и (при создании) подзадачи. Ошибка «время
 * занято» от Rust показывается в форме, окно не закрывается. Переиспользуется
 * в модалке дня/недели, в окне месяца и в карточке задачи (initial).
 * В режиме templateMode — это карточка шаблона (те же поля, сохранение через
 * onCollect).
 */
export function TaskFormFields({
  day,
  onAdded,
  onCancel,
  autoFocus = false,
  initial,
  onChange,
  templateMode = false,
  initialSubs,
  onCollect,
}: FieldsProps) {
  // В режиме шаблона это НЕ редактирование задачи: без «Перенести»/«Удалить»,
  // без файлов и авто-выполнения, подзадачи — простые тексты (как при создании).
  const editing = initial !== undefined && !templateMode;
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
  // Подзадачи: при создании и в шаблоне — тексты, которые сохранятся вместе
  // с задачей/шаблоном; при редактировании — реальные подзадачи задачи
  // (чекбоксы, удаление, добавление сразу).
  const [subs, setSubs] = useState<string[]>(templateMode ? (initialSubs ?? []) : []);
  const [newSub, setNewSub] = useState("");
  const [subItems, setSubItems] = useState<Subtask[]>([]);
  // Инлайн-редактирование текста подзадачи в карточке: клик/тап по тексту
  // переводит строку в поле ввода (как в списке под задачей).
  const [editSubId, setEditSubId] = useState<string | null>(null);
  const [editSubVal, setEditSubVal] = useState("");
  const editSubInputRef = useRef<HTMLInputElement>(null);
  const startEditSub = (s: Subtask) => {
    setEditSubId(s.id);
    setEditSubVal(s.title);
    requestAnimationFrame(() => editSubInputRef.current?.focus());
  };
  const commitEditSub = async (s: Subtask) => {
    const t = editSubVal.trim();
    setEditSubId(null);
    if (!t || t === s.title) return;
    await api.upsertSubtask({ ...s, title: t });
    setSubItems(await api.getSubtasks(s.taskId));
    // Bump: списки подзадач под задачей перечитаются сразу (а не после
    // перезагрузки), иначе переименование «зависало» до перезапуска.
    useStore.getState().bumpSubtasks();
  };
  // Ошибка загрузки подзадач: раньше .catch(() => {}) молча оставлял пустой
  // список — выглядело как «подзадач нет», хотя они есть. Теперь показываем
  // сообщение и кнопку «Повторить».
  const [subError, setSubError] = useState(false);
  // Версия списков подзадач: после promote/смены родителя (drag.tsx) bump
  // перезагружает подзадачи даже в открытой карточке (раньше список был
  // залипшим, пока карточка не пересоздалась).
  const subtaskRev = useStore((s) => s.subtaskRev);
  const loadSubItems = () => {
    if (!editing || !initial) return;
    setSubError(false);
    api
      .getSubtasks(initial.id)
      .then(setSubItems)
      .catch(() => setSubError(true));
  };
  useEffect(() => {
    loadSubItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id, subtaskRev]);
  // Вложения (файлы) задачи: у существующей задачи (карточка) — реальные
  // файлы; при создании новой задачи id ещё нет, поэтому выбранные файлы
  // буферизуем и прикрепляем сразу после создания задачи в submit.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  // Ошибка прикрепления файла — показываем рядом с кнопкой «Файл» (раньше
  // ошибки молча глотались: «не все файлы прикрепляются» без объяснения).
  const [attError, setAttError] = useState("");
  // Буфер файлов для новой задачи (ключ — стабильный для React-списка; сам
  // File в ключе нельзя — это объект, а не строка/число).
  const [pendingFiles, setPendingFiles] = useState<{ key: number; file: File }[]>([]);
  const pendingKeyRef = useRef(0);
  // Созданная задача при повторной попытке: если прикрепление файла не
  // удалось, форма остаётся открытой, а повторный «Добавить» не должен
  // создавать дубликат задачи — только до-прикрепить файлы.
  const createdTaskRef = useRef<Task | null>(null);
  // Скрытое поле выбора файла: на Android системный пикер открывает сам
  // WebView (плагин-диалог там не работает — ActivityResultLauncher не
  // регистрируется), на десктопе — нативный диалог WKWebView/Chromium.
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing || !initial) return;
    setAttLoading(true);
    api
      .listAttachments(initial.id)
      .then(setAttachments)
      .catch(() => {})
      .finally(() => setAttLoading(false));
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
    // Шаблон задачи: задачу не сохраняем — отдаём собранные данные наружу
    // (родитель пишет их в шаблон).
    if (templateMode) {
      onCollect?.({
        ...payload,
        subs: subs.map((s) => s.trim()).filter(Boolean),
      });
      return;
    }
    try {
      if (editing && initial) {
        await api.upsertTask({ ...initial, ...payload });
        // Авто-выполнение при смене времени (настройка): прошлое → выполнена,
        // будущее → выполнение снимается. Только если время изменилось и у
        // задачи ЕСТЬ дата — «Когда-нибудь» (date=0 → 1970) не «прошлая»:
        // иначе установка времени помечала бы её выполненной.
        const timeChanged = initial.timeMinutes !== time;
        if (
          autoDonePastTime &&
          timeChanged &&
          time != null &&
          !initial.someday &&
          !initial.archived
        ) {
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
        // Новая задача + подзадачи + файлы. Сначала создаём задачу (id нужен
        // для вложений), потом прикрепляем выбранные файлы.
        let created = createdTaskRef.current;
        if (!created) {
          created = await api.upsertTask({ ...payload, date: toEpochDay(day) });
          createdTaskRef.current = created;
          for (const s of subs) {
            const st = s.trim();
            if (st) await api.upsertSubtask({ taskId: created.id, title: st });
          }
        } else {
          // Повторная попытка после ошибки прикрепления: задача уже создана,
          // дубликат не создаём, но обновляем поля (подзадачи уже добавлены).
          created = await api.upsertTask({ ...created, ...payload });
          createdTaskRef.current = created;
        }
        // Файлы из буфера прикрепляем по одному; прикреплённые убираем из
        // буфера, чтобы повторная попытка (после ошибки) не создала дубликат
        // вложения. Если какой-то не прикрепился — показываем ошибку и
        // остаёмся в форме (задача уже создана, повторный «Добавить» не
        // создаст дубликат задачи — createdTaskRef).
        for (const pf of pendingFiles) {
          try {
            const b64 = await fileToBase64(pf.file);
            await api.addAttachment(
              created.id,
              pf.file.name,
              pf.file.type || mimeOf(pf.file.name),
              b64,
            );
            setPendingFiles((arr) => arr.filter((f) => f.key !== pf.key));
          } catch (err) {
            setError(
              typeof err === "string"
                ? err
                : `Не удалось прикрепить «${pf.file.name}»`,
            );
            return;
          }
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
          border: `1px solid var(--border-color)`,
          borderRadius: "var(--radius-md)",
          padding: "10px 12px",
          marginBottom: "var(--sp-4)",
          background: "transparent",
          color: COLORS.text,
          outline: "none",
        }}
      />

      {/* Время + длительность + выезд — одним пикером (системные часы/селекты).
          Бейдж — слева, как у остальных полей; само меню пикера открывается
          по центру карточки (см. TimePicker). */}
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
                border: `1px solid ${priority === p.v ? COLORS.accent : "var(--border-color)"}`,
                background: priority === p.v ? "color-mix(in srgb, var(--text-primary) 6%, transparent)" : "transparent",
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
            border: `1px solid var(--border-color)`,
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
          <DurationSelect value={notify != null && notify > 0 ? notify : null} onChange={setNotify} maxHours={168} />
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
            border: `1px solid ${color === null ? COLORS.accent : "var(--border-color)"}`,
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
            border: `1px solid var(--border-color)`,
            borderRadius: "var(--radius-md)",
            padding: "6px 10px",
            background: "transparent",
            color: COLORS.text,
            outline: "none",
            resize: "vertical",
          }}
        />
      </div>

      {/* Файлы: при создании — выбранные файлы буферизуются и прикрепятся к
          задаче при сохранении; у существующей задачи — прикреплённые файлы.
          Системный диалог → файл копируется в приватное хранилище приложения;
          тап по файлу открывает его системным приложением. */}
      {!templateMode && (
        <div style={{ ...fieldRow, alignItems: "flex-start" }}>
          <span style={labelStyle}>Файлы</span>
          <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 6 }}>
            {editing
              ? attachments.length === 0 && !attLoading && (
                  <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                    Нет файлов. Добавьте документы, фото, аудио — прикрепятся к задаче.
                  </span>
                )
              : pendingFiles.length === 0 && (
                  <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                    Нет файлов. Добавьте документы, фото, аудио — прикрепятся при сохранении.
                  </span>
                )}
            {editing &&
              attachments.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    border: `1px solid var(--border-color)`,
                    borderRadius: "var(--radius-md)",
                    padding: "4px 8px",
                  }}
                >
                  <Icon name="file" size={14} />
                  <button
                    type="button"
                    className="file-name-btn"
                    onClick={async () => {
                      try {
                        const p = await api.attachmentPath(a.id);
                        await openPath(p);
                      } catch {
                        /* нет приложения для типа файла — молча */
                      }
                    }}
                    title="Открыть файл"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "var(--fs-xs)",
                      color: COLORS.text,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {a.fileName}
                  </button>
                  <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, flexShrink: 0 }}>
                    {formatFileSize(a.size)}
                  </span>
                  <button
                    type="button"
                    className="chip-btn"
                    title="Удалить файл"
                    onClick={async () => {
                      await api.deleteAttachment(a.id);
                      setAttachments(await api.listAttachments(initial.id));
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            {!editing &&
              pendingFiles.map((pf) => (
                <div
                  key={pf.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    border: `1px solid var(--border-color)`,
                    borderRadius: "var(--radius-md)",
                    padding: "4px 8px",
                  }}
                >
                  <Icon name="file" size={14} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "var(--fs-xs)",
                      color: COLORS.text,
                    }}
                    title={pf.file.name}
                  >
                    {pf.file.name}
                  </span>
                  <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, flexShrink: 0 }}>
                    {formatFileSize(pf.file.size)}
                  </span>
                  <button
                    type="button"
                    className="chip-btn"
                    title="Убрать файл"
                    onClick={() =>
                      setPendingFiles((arr) => arr.filter((f) => f.key !== pf.key))
                    }
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            <button
              type="button"
              className="text-chip"
              disabled={attLoading}
              style={{ alignSelf: "flex-start", padding: "4px 12px" }}
              onClick={() => fileInputRef.current?.click()}
              title="Выбрать файл (системный диалог)"
            >
              <Icon name="plus" size={12} /> Файл
            </button>
            {/* Скрытый input: системный выбор файла на всех платформах. Содержимое
                читаем FileReader-ом прямо в WebView (без плагинов-диалогов) и
                отправляем в Rust base64-строкой. При создании файл лишь
                буферизуем — прикрепится в submit после создания задачи. */}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                // Сброс value: повторный выбор того же файла снова сработает.
                e.target.value = "";
                if (!file) return;
                setAttError("");
                // Лимит Rust-команды (25 МБ): отсекаем сразу, чтобы не читать
                // файл в base64 и не буферизовать заведомо несохраняемый файл.
                if (file.size > MAX_ATTACHMENT_BYTES) {
                  setAttError("Файл больше 25 МБ — не прикрепится");
                  return;
                }
                if (!editing || !initial) {
                  // Новая задача: id ещё нет — файл буферизуем, прикрепим
                  // при сохранении.
                  setPendingFiles((arr) => [
                    ...arr,
                    { key: ++pendingKeyRef.current, file },
                  ]);
                  return;
                }
                setAttLoading(true);
                try {
                  // Blob → base64 порциями (избегаем переполнения стека для
                  // больших файлов; 25 МБ — лимит Rust-команды).
                  const b64 = await fileToBase64(file);
                  const att = await api.addAttachment(
                    initial.id,
                    file.name,
                    file.type || mimeOf(file.name),
                    b64,
                  );
                  setAttachments((prev) => [...prev, att]);
                } catch (err) {
                  setAttError(
                    typeof err === "string"
                      ? err
                      : `Не удалось прикрепить «${file.name}»`,
                  );
                } finally {
                  setAttLoading(false);
                }
              }}
            />
            {attError && (
              <span style={{ fontSize: "var(--fs-2xs)", color: "var(--danger)" }}>
                {attError}
              </span>
            )}
          </div>
        </div>
      )}

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
                    // flex-start: длинный текст подзадачи переносится —
                    // чекбокс и поле остаются наверху, а не по центру.
                    alignItems: "flex-start",
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
                    style={{ margin: 0, flexShrink: 0 }}
                  />
                  {editSubId === s.id ? (
                    <input
                      ref={editSubInputRef}
                      value={editSubVal}
                      onChange={(e) => setEditSubVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEditSub(s);
                        else if (e.key === "Escape") setEditSubId(null);
                      }}
                      onBlur={() => commitEditSub(s)}
                      data-subtask-edit-id={s.id}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: "var(--fs-sm)",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid var(--accent)",
                        outline: "none",
                        color: COLORS.text,
                      }}
                    />
                  ) : (
                    <span
                      onPointerDown={(e) => {
                        // Мышь: preventDefault, чтобы не выделять текст span;
                        // на таче нативный фокус ставит курсор в поле.
                        if (e.pointerType === "mouse") e.preventDefault();
                        startEditSub(s);
                      }}
                      title={s.title || undefined}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        // Многострочный перенос: на тач-устройствах тултипа
                        // нет — однострочный ellipsis прятал длинный текст.
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        textDecoration: s.isDone ? "line-through" : "none",
                        color: s.isDone ? COLORS.muted : COLORS.text,
                        cursor: "text",
                      }}
                    >
                      {s.title}
                    </span>
                  )}
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
                    alignItems: "flex-start",
                    gap: "var(--sp-2)",
                    fontSize: "var(--fs-sm)",
                    color: COLORS.text,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.muted, flexShrink: 0, marginTop: 7 }} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
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
          {editing && subError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                fontSize: "var(--fs-xs)",
                color: "var(--danger)",
                marginBottom: "var(--sp-2)",
              }}
            >
              <span>Не удалось загрузить подзадачи</span>
              <button
                type="button"
                className="text-chip"
                onClick={loadSubItems}
                style={{ fontSize: "var(--fs-2xs)" }}
              >
                Повторить
              </button>
            </div>
          )}
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
                border: `1px dashed var(--border-color)`,
                borderRadius: "var(--radius-md)",
                padding: "6px 10px",
                background: "transparent",
                color: COLORS.text,
                outline: "none",
              }}
            />
            <button
              type="button"
              className="modal-action-btn primary compact"
              onClick={() => (editing ? addSubItem() : addSub())}
              title="Добавить подзадачу"
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
            color: "var(--danger)",
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
              style={{ flexShrink: 0 }}
            >
              <Icon name="calendarCheck" size={13} /> Перенести
            </button>
            <button
              type="button"
              className="modal-action-btn danger"
              onClick={() => setConfirmDel(true)}
              title="Удалить задачу"
              style={{ flexShrink: 0 }}
            >
              <Icon name="close" size={13} /> Удалить
            </button>
          </>
        )}
        <button
          type="submit"
          className="modal-action-btn primary"
          style={{ flex: 1 }}
        >
          {templateMode ? "Сохранить" : editing ? "Сохранить" : "Добавить"}
        </button>
        <button
          type="button"
          className="modal-action-btn"
          onClick={onCancel}
          style={{ flex: 1 }}
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
  // Рендерим в document.body через портал: карточка открывается из задач,
  // лежащих в днях с opacity<1 (прошедшие дни — «серые»). opacity создаёт
  // stacking context, и fixed-оверлей «запирался» внутри него — календарь
  // справа рисовался ПОВЕРХ карточки. Порталом уходим на уровень body.
  return createPortal(
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
          border: `1px solid var(--border-color)`,
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
    </div>,
    document.body,
  );
}

/** Файл → base64 через FileReader (порциями, чтобы не переполнить стек
 *  вызовов на больших файлах). FileReader — нативный для WebView, не зависит
 *  от плагинов-диалогов (на Android они не работают). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject("Не удалось прочитать файл");
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        const CH = 0x8000;
        let bin = "";
        for (let i = 0; i < bytes.length; i += CH) {
          bin += String.fromCharCode(...bytes.subarray(i, i + CH));
        }
        resolve(btoa(bin));
      } catch {
        reject("Не удалось закодировать файл");
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/** MIME по расширению файла — для открытия системным приложением. */
function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", pdf: "application/pdf",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", heic: "image/heic",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
    mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
    json: "application/json", csv: "text/csv", html: "text/html", apk: "application/vnd.android.package-archive",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Размер файла человекочитаемо: «1.2 МБ», «340 КБ», «900 Б». */
function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}
