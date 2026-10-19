import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Subtask } from "../api";
import { api } from "../api";
import { COLORS } from "../theme";
import { Icon } from "./Icon";
import { subtaskDragId } from "../drag";
import { useSubtasks } from "../useSubtasks";
import { showToast } from "../toast";
import { useI18n } from "../i18n";

/** Порог «тап или прокрутка» (px), как у TaskCard. */
const TAP_SLOP_PX = 10;

interface Props {
  taskId: string;
}

/**
 * Чек-лист подзадач под задачей: заголовок (если есть подзадачи) и список
 * (строки draggable). Добавляются подзадачи только в карточке задачи (✎):
 * поле ввода на главном экране убрано ради чистоты вида.
 * Текст подзадачи редактируется прямо в строке (как текст задачи) — тап/клик
 * по тексту переводит строку в инлайн-редактирование. Карточка родительской
 * задачи открывается ТОЛЬКО кнопкой «✎» в строке задачи.
 */
export function SubtaskList({ taskId }: Props) {
  const { t } = useI18n();
  // Подзадачи + перезагрузка (общий хук: защита от гонки размонтирования,
  // глобальный subtaskRev после promote/смены родителя).
  const { items, error: loadError, reload } = useSubtasks(taskId);

  const toggle = async (s: Subtask) => {
    try {
      await api.upsertSubtask({ ...s, isDone: !s.isDone });
    } catch (e) {
      showToast(t("err.toggleSubtask", { error: String(e) }));
    }
    reload();
  };

  const done = items.filter((s) => s.isDone).length;

  if (items.length === 0 && !loadError) return null;

  return (
    <div className="subtasks-area">
      {items.length > 0 && (
        <div
          style={{
            fontSize: "var(--fs-sm)",
            color: COLORS.muted,
            marginBottom: 2,
            fontWeight: 400,
            userSelect: "none",
          }}
        >
          {t("subtasks.title", { done, total: items.length })}
        </div>
      )}
      {items.map((s) => (
        <SubtaskRow
          key={s.id}
          subtask={s}
          onToggle={() => toggle(s)}
          onRename={async (sub, title) => {
            try {
              await api.upsertSubtask({ ...sub, title });
            } catch (e) {
              showToast(t("err.renameSubtask", { error: String(e) }));
            }
            reload();
          }}
        />
      ))}
      {/* Ошибка загрузки — не молчим (раньше пустой список читался как
          «подзадач нет»). */}
      {loadError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            fontSize: "var(--fs-sm)",
            color: "var(--danger)",
          }}
        >
          <span>{t("err.loadSubtasks")}</span>
          <button className="text-chip" onClick={reload} style={{ fontSize: "var(--fs-sm)" }}>
            {t("common.retry")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Строка подзадачи — draggable (можно перетащить в другой день → promote,
 *  или на другую задачу → сменить родителя). Текст подзадачи редактируется
 *  прямо в строке (как текст задачи): клик/тап по тексту переводит строку
 *  в инлайн-редактирование (фокус + выделение на десктопе). Карточка
 *  родительской задачи — ТОЛЬКО кнопкой «✎» в строке задачи. */
function SubtaskRow({
  subtask,
  onToggle,
  onRename,
}: {
  subtask: Subtask;
  onToggle: () => void;
  /** Переименовать подзадачу (Enter/blur в режиме редактирования). */
  onRename?: (s: Subtask, title: string) => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: subtaskDragId(subtask.id),
    data: { subtask },
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(subtask.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // При переходе в редактирование — фокус на поле (после монтирования input).
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  // Вход в редактирование: клик/тап по тексту подзадачи — фокус + выделение
  // (как у задач). preventDefault только для мыши, чтобы не выделять текст
  // на span; на таче нативный фокус ставит курсор в место тапа.
  const tapStart = useRef<{ x: number; y: number } | null>(null);
  const beginEdit = (selectAll: boolean) => {
    setValue(subtask.title);
    setEditing(true);
    if (selectAll) requestAnimationFrame(() => inputRef.current?.select());
  };
  // Мышь — правка сразу по нажатию, с выделением всего текста (как у задач).
  // Палец — только запоминаем точку: pointerdown на таче — это и начало
  // прокрутки, и раньше каждый скролл, начатый на подзадаче, открывал
  // клавиатуру. Правка — в onClick, если палец почти не сдвинулся.
  const startEdit = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      e.preventDefault();
      beginEdit(true);
    } else {
      tapStart.current = { x: e.clientX, y: e.clientY };
    }
  };
  const tapEdit = (e: React.MouseEvent) => {
    const start = tapStart.current;
    tapStart.current = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_SLOP_PX) {
      beginEdit(false);
    }
  };

  const commit = () => {
    const t = value.trim();
    setEditing(false);
    if (t && t !== subtask.title) onRename?.(subtask, t);
  };

  return (
    <div
      ref={setNodeRef}
      className="subtask-row"
      style={{
        display: "flex",
        // flex-start: текст подзадачи переносится на несколько строк —
        // чекбокс/ручка/кнопка остаются наверху строки, а не по центру.
        alignItems: "flex-start",
        gap: "var(--sp-2)",
        padding: "1px 0",
        opacity: isDragging ? 0.4 : undefined,
        // Шрифт строки = шрифт текста подзадачи: чекбокс (1em) не должен
        // вырастать больше текста (подзадача «больше самой задачи»).
        fontSize: "var(--fs-sm)",
      }}
      {...attributes}
    >
      {/* Ручка перетаскивания подзадачи: listeners ТОЛЬКО тут, чтобы чекбокс и
          кнопку ✕ можно было кликать. Явная подсказка «тяни тут». */}
      <span
        {...listeners}
        title={t("subtasks.dragHint")}
        style={{
          flexShrink: 0,
          width: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.muted,
          opacity: 0.5,
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <Icon name="dots" size={14} />
      </span>
      <label
        className="checkbox-hit"
        style={{
          margin: 0,
          flexShrink: 0,
          // Метка — touch-таргет 28px с визуальным чекбоксом по центру;
          // при flex-start она бы опускала квадрат на ~6px ниже первой
          // строки текста. Поднимаем, чтобы чекбокс стоял на первой строке
          // (однострочной и многострочной) ровно.
          marginTop: -6,
        }}
      >
        <input
          type="checkbox"
          checked={subtask.isDone}
          onChange={onToggle}
          style={{ margin: 0 }}
        />
      </label>
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commit}
          data-subtask-id={subtask.id}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--fs-sm)",
            background: "transparent",
            border: "none",
            outline: "none",
            color: subtask.isDone ? COLORS.muted : COLORS.text,
            textDecoration: subtask.isDone ? "line-through" : "none",
          }}
        />
      ) : (
        <span
          onPointerDown={startEdit}
          onClick={tapEdit}
          title={subtask.title || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--fs-sm)",
            color: subtask.isDone ? COLORS.muted : COLORS.text,
            textDecoration: subtask.isDone ? "line-through" : "none",
            // Многострочный перенос: на тач-устройствах тултипа нет, и
            // однострочный ellipsis делал длинный текст нечитаемым вовсе.
            // pre-wrap сохраняет явные переводы строк, anywhere рвёт и
            // длинные слова/ссылки.
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            cursor: "text",
          }}
        >
          {subtask.title}
        </span>
      )}
    </div>
  );
}
