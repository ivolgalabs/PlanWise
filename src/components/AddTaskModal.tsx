import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Attachment, Subtask, Task } from "../api";
import { api } from "../api";
import { toEpochDay, fromEpochDay, dueEpochLabel } from "../date";
import { useStore } from "../store";
import { COLORS, argbToHex } from "../theme";
import { TimePicker, DurationSelect } from "./TimePicker";
import { Icon } from "./Icon";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePickerModal } from "./DatePickerModal";
import { useI18n, t, type TKey } from "../i18n";

/** Уровни приоритета: 0 = не задан, 1 = низкий, 2 = средний, 3 = высокий.
 *  Цвета — глобальные CSS-переменные приоритета (themes.css).
 *  Подписи — ключи словаря (собираются при рендере, язык переключается сразу). */
const PRIO: { v: number; labelKey: TKey | null; color: string }[] = [
  { v: 0, labelKey: null, color: "" },
  { v: 1, labelKey: "task.low", color: "var(--prio-low)" },
  { v: 2, labelKey: "task.medium", color: "var(--prio-med)" },
  { v: 3, labelKey: "task.high", color: "var(--prio-high)" },
];

/** Лимит вложения (совпадает с Rust: 25 МБ на команду) — отсекаем файлы
 *  сразу при выборе, чтобы не читать в base64 то, что всё равно не сохранится. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Варианты «Уведомить»: по умолчанию (глобальные интервалы настроек),
 *  не уведомлять или своё значение — КОЛИЧЕСТВО времени до начала
 *  (селекты «часы»/«минуты», системный барабан). */
const NOTIFY_OPTS: { v: number; label: TKey }[] = [
  { v: -1, label: "form.notifyDefault" },
  { v: 0, label: "form.notifyNone" },
  { v: 5, label: "form.notify5" },
  { v: 15, label: "form.notify15" },
  { v: 30, label: "form.notify30" },
  { v: 60, label: "form.notify60" },
  { v: 120, label: "form.notify120" },
  { v: 180, label: "form.notify180" },
  { v: 1440, label: "form.notify1440" },
  { v: -2, label: "form.notifyCustom" },
];

/** Поля карточки, которые прячутся за кнопкой «+ …», пока не заполнены. */
type Field = "time" | "priority" | "repeat" | "notify" | "color" | "note" | "files" | "steps";

interface FieldsProps {
  /** День, на который добавляется задача (для создания) или день задачи. */
  day: Date;
  /** Вызывается после успешного сохранения (родитель решает — закрыть). */
  onAdded?: () => void;
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
    travelNotifyMinutes: number | null;
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
  const { t, lang } = useI18n();
  // В режиме шаблона это НЕ редактирование задачи: без «Перенести»/«Удалить»,
  // без файлов и авто-выполнения, подзадачи — простые тексты (как при создании).
  const editing = initial !== undefined && !templateMode;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [time, setTime] = useState<number | null>(initial?.timeMinutes ?? null);
  const [priority, setPriority] = useState(initial?.difficulty ?? 0);
  const [duration, setDuration] = useState<number | null>(initial?.durationMinutes ?? null);
  const [travel, setTravel] = useState<number | null>(initial?.travelTime ?? null);
  const [travelNotify, setTravelNotify] = useState<number | null>(initial?.travelNotifyMinutes ?? null);
  const [color, setColor] = useState<string | null>(initial?.colorSetId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Своё уведомление: null = по умолчанию; select хранит -1 для «по умолчанию»,
  // -2 для «Своё значение…» (показывает системные часы).
  const [notify, setNotify] = useState<number | null>(initial?.notifyMinutes ?? null);
  const [customNotify, setCustomNotify] = useState(false);
  // «Когда-нибудь»: мягкий срок (epoch-day). null = без срока. Смысл только
  // у задачи «Когда-нибудь» (initial.someday) — у задач дня не показываем.
  const [dueEpochDay, setDueEpochDay] = useState<number | null>(initial?.dueEpochDay ?? null);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [repeat, setRepeat] = useState<Task["repeat"]>(initial?.repeat ?? null);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // «Когда»: выбранный, но не сохранённый день (epoch) или «Позже»; null — без
  // изменений. Перенос — в submit ПОСЛЕ записи полей: upsert со старым
  // initial.date иначе откатил бы перенос.
  const [when, setWhen] = useState<number | "someday" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Поля, раскрытые кнопкой «+ …»; заполненные видны всегда.
  const [opened, setOpened] = useState<ReadonlySet<Field>>(new Set());
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
  // Авто-высота заголовка: длинный текст переносится, а не обрезается в одну
  // строку. Было однострочное <input> — хвост длинной задачи «не виден» при
  // редактировании и после сохранения (см. «если задача длинная — не видно»).
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);
  const startEditSub = (s: Subtask) => {
    setEditSubId(s.id);
    setEditSubVal(s.title);
    requestAnimationFrame(() => editSubInputRef.current?.focus());
  };
  const commitEditSub = async (s: Subtask) => {
    const nextTitle = editSubVal.trim();
    setEditSubId(null);
    if (!nextTitle || nextTitle === s.title) return;
    await api.upsertSubtask({ ...s, title: nextTitle });
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
  const { colorSets } = useStore();
  const sets = colorSets.filter((s) => s.id !== "cs-none");

  // Прогрессивное раскрытие: карточка показывает только заданное, остальное —
  // кнопками «+ Время», «+ Повтор»… (меньше решений на экране за раз).
  const postponed = editing ? (initial?.postponeCount ?? 0) : 0;
  const has: Record<Field, boolean> = {
    time: time != null || duration != null || travel != null,
    priority: priority > 0,
    repeat: repeat != null,
    notify: notify != null || customNotify,
    color: color != null,
    note: notes !== "",
    files: attachments.length > 0 || pendingFiles.length > 0,
    // Застрявшей задаче (↻≥2) шаги открыты сразу — с подсказкой разбить её.
    steps: subItems.length > 0 || subs.length > 0 || postponed >= 2,
  };
  const show = (f: Field) => has[f] || opened.has(f);
  const addable: { f: Field; label: TKey; ok: boolean }[] = [
    { f: "time", label: "form.time", ok: true },
    { f: "steps", label: "form.subtasks", ok: true },
    { f: "repeat", label: "form.repeat", ok: !templateMode && !initial?.someday },
    { f: "notify", label: "form.notify", ok: true },
    { f: "priority", label: "form.priority", ok: true },
    { f: "color", label: "form.color", ok: true },
    { f: "note", label: "task.note", ok: true },
    { f: "files", label: "form.files", ok: !templateMode },
  ];
  const hidden = addable.filter((a) => a.ok && !show(a.f));
  // ✕ у раскрытого поля: сбросить значение и снова спрятать за «+».
  const clearBtn = (f: Field, clear: () => void) => (
    <button
      type="button"
      className="chip-btn field-clear"
      title={t("common.remove")}
      aria-label={t("common.remove")}
      onClick={() => {
        clear();
        setOpened((s) => {
          const n = new Set(s);
          n.delete(f);
          return n;
        });
      }}
    >
      <Icon name="close" size={12} />
    </button>
  );
  // «Когда» в карточке задачи: Сегодня / Завтра / Позже / дата.
  const todayEpoch = toEpochDay(new Date());
  const origWhen: number | "someday" = initial?.someday ? "someday" : (initial?.date ?? todayEpoch);
  const curWhen = when ?? origWhen;
  const pickWhen = (v: number | "someday") => setWhen(v === origWhen ? null : v);
  const customDay = typeof curWhen === "number" && curWhen !== todayEpoch && curWhen !== todayEpoch + 1;

  const notifySelectValue = () => {
    if (notify == null) return -1;
    if (NOTIFY_OPTS.some((o) => o.v === notify)) return notify;
    return -2; // своё значение, которого нет в списке
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setError("");
    const payload = {
      title: nextTitle,
      timeMinutes: time,
      difficulty: priority,
      durationMinutes: duration,
      travelTime: travel,
      colorSetId: color,
      notes,
      notifyMinutes: notify,
      // «До выезда» отправляем только когда выезд задан (иначе поле лишнее).
      travelNotifyMinutes: travel != null ? travelNotify : null,
      dueEpochDay,
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
        // Флашим набранную, но не добавленную через «+» подзадачу: кнопка
        // «Сохранить» должна сохранить и то, что в поле «+ подзадача», иначе
        // она выглядит как «ничего не произошло» (submit не читал newSub).
        const pendingSub = newSub.trim();
        if (pendingSub) {
          await api.upsertSubtask({ taskId: initial.id, title: pendingSub });
          setNewSub("");
          useStore.getState().bumpSubtasks();
        }
        await api.upsertTask({ ...initial, ...payload, repeat });
        onChange?.();
        // Перенос после записи полей. Ошибка (лимит переносов) — в форме,
        // правки уже сохранены и список обновлён выше.
        if (when === "someday") await api.setSomeday(initial.id);
        else if (when !== null) await api.moveTask(initial.id, fromEpochDay(when));
      } else {
        // Новая задача + подзадачи + файлы. Сначала создаём задачу (id нужен
        // для вложений), потом прикрепляем выбранные файлы.
        let created = createdTaskRef.current;
        if (!created) {
          created = await api.upsertTask({ ...payload, repeat, date: toEpochDay(day) });
          createdTaskRef.current = created;
          for (const s of subs) {
            const st = s.trim();
            if (st) await api.upsertSubtask({ taskId: created.id, title: st });
          }
          // Флашим набранную, но не добавленную через «+» подзадачу.
          const pendingSub = newSub.trim();
          if (pendingSub) {
            await api.upsertSubtask({ taskId: created.id, title: pendingSub });
            setNewSub("");
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
                : t("err.attachFile", { name: pf.file.name }),
            );
            return;
          }
        }
      }
      onAdded?.();
    } catch (err) {
      // Rust не дал сохранить (время занято другой задачей) — показываем
      // сообщение, форма остаётся открытой.
      setError(typeof err === "string" ? err : t("err.saveTaskShort"));
    }
  };

  const del = async () => {
    if (!initial) return;
    setConfirmDel(false);
    await api.deleteTask(initial.id);
    onChange?.();
    onAdded?.();
  };

  // Дублирование: копия задачи (включая время/длительность/напоминания —
  // будильники клона планировщик заведёт сам) + подзадачи. Копируются
  // СОХРАНЁННЫЕ поля задачи: несохранённые правки формы в копию не идут.
  // После копии карточка закрывается — обе задачи видны в списке.
  const duplicate = async () => {
    if (!initial) return;
    try {
      await api.duplicateTask(initial.id);
      onChange?.();
      onAdded?.();
    } catch (err) {
      setError(typeof err === "string" ? err : t("err.duplicateTask"));
    }
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
    // Bump: списки подзадач под задачей в главном окне перечитаются сразу,
    // иначе добавление в карточке «не доходит» до основного окна.
    useStore.getState().bumpSubtasks();
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
      <textarea
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          // Enter — сохранить (как было у <input>); Shift+Enter — перенос строки.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        enterKeyHint="done"
        placeholder={t("form.titlePh")}
        autoFocus={autoFocus}
        rows={1}
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
          resize: "none",
          overflow: "hidden",
          lineHeight: 1.4,
        }}
      />

      {/* «Когда»: перенос одним тапом вместо кнопки «Перенести» с календарём.
          Применяется при «Сохранить». */}
      {editing && (
        <div style={fieldRow}>
          <span style={labelStyle}>{t("form.when")}</span>
          <div className="chip-group">
            {([
              [todayEpoch, t("common.today")],
              [todayEpoch + 1, t("close.tomorrow")],
              ["someday", t("common.someday")],
            ] as const).map(([v, label]) => (
              <button key={String(v)} type="button" className="text-chip" aria-pressed={curWhen === v} onClick={() => pickWhen(v)}>
                {label}
              </button>
            ))}
            <button
              type="button"
              className="text-chip"
              aria-pressed={customDay}
              title={t("form.moveTitle")}
              onClick={() => setMoveOpen(true)}
            >
              {customDay
                ? fromEpochDay(curWhen).toLocaleDateString(lang, { day: "numeric", month: "short" })
                : t("form.dueDate")}
            </button>
          </div>
        </div>
      )}

      {/* Время + длительность + выезд — одним пикером (системные часы/селекты).
          Бейдж — слева, как у остальных полей; само меню пикера открывается
          по центру карточки (см. TimePicker). */}
      {show("time") && (
      <div style={fieldRow}>
        <span style={labelStyle}>{t("form.time")}</span>
        {clearBtn("time", () => {
          setTime(null);
          setDuration(null);
          setTravel(null);
          setTravelNotify(null);
        })}
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
      )}

      {/* Приоритет — явные кнопки с подписями («без приоритета» — ✕ поля). */}
      {show("priority") && (
      <div style={fieldRow}>
        <span style={labelStyle}>{t("form.priority")}</span>
        {clearBtn("priority", () => setPriority(0))}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
          {PRIO.filter((p) => p.v > 0).map((p) => (
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
              title={p.labelKey ? t(p.labelKey) : "—"}
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
              {p.labelKey ? t(p.labelKey) : "—"}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* «Когда-нибудь»: мягкий срок — сделать в течение недели/месяца/к дате. */}
      {editing && initial?.someday && (
        <div style={fieldRow}>
          <span style={labelStyle}>{t("form.due")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", alignItems: "center" }}>
            <button type="button" className="text-chip" onClick={() => setDueEpochDay(null)}>{t("form.noDue")}</button>
            <button type="button" className="text-chip" onClick={() => setDueEpochDay(toEpochDay(new Date()) + 7)}>{t("someday.week")}</button>
            <button type="button" className="text-chip" onClick={() => setDueEpochDay(toEpochDay(new Date()) + 30)}>{t("someday.month")}</button>
            <button type="button" className="text-chip" onClick={() => setDueDateOpen(true)}>{t("form.dueDate")}</button>
            {dueEpochDay != null && (
              <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                {dueEpochLabel(dueEpochDay)}
              </span>
            )}
          </div>
        </div>
      )}
      {!templateMode && !initial?.someday && show("repeat") && (
        <div style={fieldRow}>
          <span style={labelStyle}>{t("form.repeat")}</span>
          {clearBtn("repeat", () => setRepeat(null))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
            {([null, "daily", "weekly", "monthly"] as const).map((r) => (
              <button
                key={r ?? "none"}
                type="button"
                className="text-chip"
                style={{ border: `1px solid ${repeat === r ? COLORS.accent : "var(--border-color)"}` }}
                aria-pressed={repeat === r}
                onClick={() => setRepeat(r)}
              >
                {t(`repeat.${r ?? "none"}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {dueDateOpen && (
        <DatePickerModal
          tasks={[]}
          onPick={(d) => {
            setDueEpochDay(toEpochDay(d));
            setDueDateOpen(false);
          }}
          onClose={() => setDueDateOpen(false)}
        />
      )}

      {/* Своё уведомление задачи: по умолчанию / не уведомлять / за N минут /
          своё значение системными часами. Подзадачи наследуют уведомление. */}
      {show("notify") && (
      <div style={fieldRow}>
        <span style={labelStyle}>{t("form.notify")}</span>
        {clearBtn("notify", () => {
          setNotify(null);
          setCustomNotify(false);
        })}
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
              {t(o.label)}
            </option>
          ))}
        </select>
        {customNotify && (
          /* Своё значение — КОЛИЧЕСТВО времени до начала (системные
             селекты «ч»/«мин»), а не время суток. */
          <DurationSelect value={notify != null && notify > 0 ? notify : null} onChange={setNotify} maxHours={168} />
        )}
        {time == null && notify !== 0 && (
          /* Задача без времени: «за N минут до начала» не определено —
             напомним утром дня задачи (дайджест, а при выключенном —
             отдельный утренний пинг; см. task_events в notify.rs). */
          <span
            style={{
              flexBasis: "100%",
              fontSize: "var(--fs-2xs)",
              color: COLORS.muted,
            }}
          >
            {t("form.allDayHint")}
          </span>
        )}
      </div>
      )}

      {/* «До выезда»: напомнить за N минут ДО момента выезда (раньше, чем
          «Пора выезжать» в сам выезд). Виден только когда задан выезд. */}
      {travel != null && (
        <div style={fieldRow}>
          <span style={labelStyle}>{t("form.beforeTravel")}</span>
          <select
            value={travelNotify ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTravelNotify(v > 0 ? v : null);
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
            <option value={0}>{t("form.travelNone")}</option>
            <option value={5}>{t("form.travel5")}</option>
            <option value={15}>{t("form.travel15")}</option>
            <option value={30}>{t("form.travel30")}</option>
            <option value={60}>{t("form.travel60")}</option>
          </select>
        </div>
      )}

      {/* Категория — свотчи с подписями («без категории» — ✕ поля). */}
      {show("color") && (
      <div style={fieldRow}>
        <span style={labelStyle}>{t("form.color")}</span>
        {clearBtn("color", () => setColor(null))}
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
      )}

      {/* Заметка к задаче. */}
      {show("note") && (
      <div style={fieldRow}>
        <span style={labelStyle}>{t("task.note")}</span>
        {clearBtn("note", () => setNotes(""))}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("form.notesPh")}
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
      )}

      {/* Файлы: при создании — выбранные файлы буферизуются и прикрепятся к
          задаче при сохранении; у существующей задачи — прикреплённые файлы.
          Системный диалог → файл копируется в приватное хранилище приложения;
          тап по файлу открывает его системным приложением. */}
      {!templateMode && show("files") && (
        <div style={{ ...fieldRow, alignItems: "flex-start" }}>
          <span style={labelStyle}>{t("form.files")}</span>
          <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 6 }}>
            {editing
              ? attachments.length === 0 && !attLoading && (
                  <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                    {t("form.noFilesExisting")}
                  </span>
                )
              : pendingFiles.length === 0 && (
                  <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                    {t("form.noFilesNew")}
                  </span>
                )}
            {editing &&
              attachments.map((a) => (
                <AttachmentRow
                  key={a.id}
                  name={a.fileName}
                  size={a.size}
                  onOpen={async () => {
                    try {
                      const p = await api.attachmentPath(a.id);
                      await openPath(p);
                    } catch {
                      /* нет приложения для типа файла — молча */
                    }
                  }}
                  onRemove={async () => {
                    await api.deleteAttachment(a.id);
                    setAttachments(await api.listAttachments(initial.id));
                  }}
                  removeTitle={t("form.removeFile")}
                />
              ))}
            {!editing &&
              pendingFiles.map((pf) => (
                <AttachmentRow
                  key={pf.key}
                  name={pf.file.name}
                  size={pf.file.size}
                  onRemove={() =>
                    setPendingFiles((arr) => arr.filter((f) => f.key !== pf.key))
                  }
                  removeTitle={t("form.detachFile")}
                />
              ))}
            <button
              type="button"
              className="text-chip"
              disabled={attLoading}
              style={{ alignSelf: "flex-start", padding: "4px 12px" }}
              onClick={() => fileInputRef.current?.click()}
              title={t("form.pickFile")}
            >
              <Icon name="plus" size={12} /> {t("form.file")}
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
                  setAttError(t("form.tooBig"));
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
                      : t("err.attachFile", { name: file.name }),
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
      {show("steps") && (
      <div style={{ ...fieldRow, alignItems: "flex-start" }}>
        <span style={labelStyle}>{t("form.subtasks")}</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          {/* Задачу переносили 2+ раз: обычно она слишком большая или
              расплывчатая — подсказываем начать с маленького шага. */}
          {postponed >= 2 && <div className="steps-hint">{t("form.stepsHint")}</div>}
          {editing
            ? subItems.map((s) => (
                <div
                  key={s.id}
                  className="subtask-row"
                  style={{
                    display: "flex",
                    // flex-start: длинный текст подзадачи переносится —
                    // чекбокс и поле остаются наверху, а не по центру.
                    alignItems: "flex-start",
                    gap: "var(--sp-2)",
                    // Вертикальный отступ: строки плотные (без него кнопки
                    // удаления 24px стоят вплотную друг к другу — выглядит
                    // как наслоение).
                    padding: "3px 0",
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
                      useStore.getState().bumpSubtasks();
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
                      useStore.getState().bumpSubtasks();
                    }}
                    title={t("month.deleteSubtask")}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))
            : subs.map((s, i) => (
                <div
                  key={i}
                  className="subtask-row"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--sp-2)",
                    padding: "3px 0",
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
                    title={t("common.remove")}
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
              <span>{t("err.loadSubtasks")}</span>
              <button
                type="button"
                className="text-chip"
                onClick={loadSubItems}
                style={{ fontSize: "var(--fs-2xs)" }}
              >
                {t("common.retry")}
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
              placeholder={t("subtasks.addPh")}
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
              title={t("form.addSubtask")}
            >
              +
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Незаданные поля — кнопками; тап раскрывает поле. */}
      {hidden.length > 0 && (
        <div className="chip-group" style={{ marginBottom: "var(--sp-4)" }}>
          {hidden.map((a) => (
            <button
              key={a.f}
              type="button"
              className="text-chip"
              onClick={() => setOpened((s) => new Set(s).add(a.f))}
            >
              + {t(a.label)}
            </button>
          ))}
        </div>
      )}

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

      {/* Редкие действия (дубль/удаление) — под «⋯»: на виду только
          Отмена и Сохранить, «Удалить» не стоит рядом с главной кнопкой. */}
      {editing && moreOpen && (
        <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
          <button
            type="button"
            className="modal-action-btn"
            onClick={duplicate}
            title={t("form.duplicateTitle")}
            style={{ flex: 1 }}
          >
            <Icon name="copy" size={13} /> {t("form.duplicate")}
          </button>
          <button
            type="button"
            className="modal-action-btn danger"
            onClick={() => setConfirmDel(true)}
            title={t("form.deleteTaskTitle")}
            style={{ flex: 1 }}
          >
            <Icon name="close" size={13} /> {t("common.delete")}
          </button>
        </div>
      )}
      <div className="card-footer" style={{ background: COLORS.card }}>
        {editing && (
          <button
            type="button"
            className="modal-action-btn compact"
            aria-label={t("form.more")}
            title={t("form.more")}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <Icon name="dots" size={14} />
          </button>
        )}
        <button
          type="button"
          className="modal-action-btn"
          onClick={onCancel}
          style={{ flex: 1 }}
        >
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="modal-action-btn primary"
          style={{ flex: 1 }}
        >
          {templateMode ? t("common.save") : editing ? t("common.save") : t("common.add")}
        </button>
      </div>

      {confirmDel && (
        <ConfirmDialog
          title={t("form.confirmDelete", { title: title.trim() || t("common.unnamed") })}
          confirmLabel={t("common.delete")}
          onConfirm={del}
          onCancel={() => setConfirmDel(false)}
        />
      )}
      {moveOpen && initial && (
        <DatePickerModal
          tasks={[]}
          onPick={(d) => {
            pickWhen(toEpochDay(d));
            setMoveOpen(false);
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
  const { t, lang } = useI18n();
  const editing = initial !== undefined;
  // Защита от «клика-призрака»: карточка открылась по тапу на задачу, а
  // отпускание пальца попало на оверлей (position:fixed) — такой клик не
  // должен сразу закрывать только что открытое окно.
  const openedAt = useRef(Date.now());
  const postponedCount = initial?.postponeCount ?? 0;
  // Задача «Когда-нибудь» не привязана ко дню — заголовок без даты.
  const head = editing && initial?.someday
    ? t("common.someday")
    : day.toLocaleDateString(lang, { day: "numeric", month: "long", weekday: "long" });
  // Рендерим в document.body через портал: карточка открывается из задач,
  // лежащих в днях с opacity<1 (прошедшие дни — «серые»). opacity создаёт
  // stacking context, и fixed-оверлей «запирался» внутри него — календарь
  // справа рисовался ПОВЕРХ карточки. Порталом уходим на уровень body.
  return createPortal(
    <div
      className="modal-overlay task-sheet-overlay"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (Date.now() - openedAt.current < 300) return;
        onClose();
      }}
      style={{ zIndex: 200 }}
    >
      {/* .task-sheet: по центру на десктопе, лист снизу на телефоне (App.css). */}
      <div
        className="task-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: COLORS.card,
          border: `1px solid var(--border-color)`,
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div
          style={{
            fontSize: "var(--fs-lg)",
            fontWeight: 700,
            color: COLORS.text,
            marginBottom: postponedCount > 0 ? "var(--sp-1)" : "var(--sp-5)",
            textTransform: "capitalize",
          }}
        >
          {head}
        </div>
        {/* Сколько раз задачу уже переносили — честный сигнал без упрёка. */}
        {postponedCount > 0 && (
          <div className={`card-postponed${postponedCount >= 3 ? " stuck" : ""}`}>
            ↻ {t("card.postponed", { n: postponedCount })}
          </div>
        )}
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
    reader.onerror = () => reject(t("err.readFile"));
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
        reject(t("err.encodeFile"));
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
  if (bytes >= 1_048_576) return t("unit.mb", { n: (bytes / 1_048_576).toFixed(1) });
  if (bytes >= 1024) return t("unit.kb", { n: Math.round(bytes / 1024) });
  return t("unit.b", { n: bytes });
}

/** Строка вложения в форме: иконка + имя (сохранённые — кнопка «открыть»,
 *  буферизованные — текст) + размер + удаление. Общее для обоих списков. */
function AttachmentRow({
  name,
  size,
  onOpen,
  onRemove,
  removeTitle,
}: {
  name: string;
  size: number;
  onOpen?: () => void;
  onRemove: () => void;
  removeTitle: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "4px 8px",
      }}
    >
      <Icon name="file" size={14} />
      {onOpen ? (
        <button
          type="button"
          className="file-name-btn"
          onClick={onOpen}
          title={t("form.openFile")}
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
          {name}
        </button>
      ) : (
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
          title={name}
        >
          {name}
        </span>
      )}
      <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, flexShrink: 0 }}>
        {formatFileSize(size)}
      </span>
      <button type="button" className="chip-btn" title={removeTitle} onClick={onRemove}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
