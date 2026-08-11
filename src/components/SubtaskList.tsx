import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Subtask } from "../api";
import { api } from "../api";
import { COLORS } from "../theme";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { subtaskDragId } from "../drag";

interface Props {
  taskId: string;
  /** Открыть карточку родительской задачи (по нажатию на подзадачу). */
  onOpenCard?: () => void;
}

/**
 * Чек-лист подзадач под задачей: всегда виден — заголовок (если есть подзадачи),
 * список (строки draggable) и поле ввода «+ подзадача». Поле всегда на месте,
 * поэтому добавить подзадачу можно в любом виде. Нажатие на подзадачу
 * открывает карточку родительской задачи (там полные настройки).
 */
export function SubtaskList({ taskId, onOpenCard }: Props) {
  const [items, setItems] = useState<Subtask[]>([]);
  const [newTitle, setNewTitle] = useState("");
  // Ошибка загрузки: раньше unhandled rejection молча оставлял пустой список
  // (выглядело как «подзадач нет»). Теперь показываем сообщение с ретраем.
  const [loadError, setLoadError] = useState(false);
  // Версия списков подзадач: после promote/смены родителя (drag.tsx) список
  // должен перечитаться — иначе удалённая подзадача «висит» у старого родителя.
  const subtaskRev = useStore((s) => s.subtaskRev);

  const load = async () => {
    try {
      setLoadError(false);
      setItems(await api.getSubtasks(taskId));
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, subtaskRev]);

  const add = async () => {
    const t = newTitle.trim();
    if (!t) return;
    await api.upsertSubtask({ taskId, title: t });
    setNewTitle("");
    load();
  };

  const toggle = async (s: Subtask) => {
    await api.upsertSubtask({ ...s, isDone: !s.isDone });
    load();
  };

  const del = async (id: string) => {
    await api.deleteSubtask(id);
    load();
  };

  const done = items.filter((s) => s.isDone).length;

  // Всегда показываем блок подзадач: заголовок (если есть подзадачи) + список
  // + поле ввода. Это решает «нельзя добавить подзадачу» — поле всегда на месте.
  return (
    <div className="subtasks-area">
      {items.length > 0 && (
        <div
          style={{
            fontSize: "var(--fs-2xs)",
            color: COLORS.muted,
            marginBottom: 2,
            fontWeight: 600,
            userSelect: "none",
          }}
        >
          Подзадачи ({done}/{items.length})
        </div>
      )}
      {items.map((s) => (
        <SubtaskRow
          key={s.id}
          subtask={s}
          onToggle={() => toggle(s)}
          onDelete={() => del(s.id)}
          onOpenCard={onOpenCard}
          onRename={async (sub, title) => {
            await api.upsertSubtask({ ...sub, title });
            load();
          }}
        />
      ))}
      {/* Ошибка загрузки — не молчим (раньше пустой список читался как
          «подзадач нет»). Поле «+ подзадача» остаётся на месте. */}
      {loadError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            fontSize: "var(--fs-2xs)",
            color: "var(--danger)",
          }}
        >
          <span>Не удалось загрузить подзадачи</span>
          <button className="text-chip" onClick={load} style={{ fontSize: "var(--fs-2xs)" }}>
            Повторить
          </button>
        </div>
      )}
      {/* Форма: на мобильной клавиатуре кнопка «Далее/Готово» (enterKeyHint)
          срабатывает как Enter — добавляет подзадачу. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          enterKeyHint="done"
          placeholder="+ подзадача"
          className="inline-input"
          style={{
            width: "100%",
            border: "none",
            padding: "1px 0",
            fontSize: "var(--fs-2xs)",
            background: "transparent",
            outline: "none",
            color: COLORS.text,
          }}
        />
      </form>
    </div>
  );
}

/** Строка подзадачи — draggable (можно перетащить в другой день → promote,
 *  или на другую задачу → сменить родителя). Нажатие на текст подзадачи
 *  открывает карточку родительской задачи; на десктопе клик мышью по тексту
 *  переводит строку в инлайн-редактирование (фокус + выделение, как у задач). */
function SubtaskRow({
  subtask,
  onToggle,
  onDelete,
  onOpenCard,
  onRename,
}: {
  subtask: Subtask;
  onToggle: () => void;
  onDelete: () => void;
  onOpenCard?: () => void;
  /** Переименовать подзадачу (Enter/blur в режиме редактирования). */
  onRename?: (s: Subtask, title: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: subtaskDragId(subtask.id),
    data: { subtask },
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(subtask.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Вход в редактирование: клик мышью по тексту подзадачи — фокус + выделение.
  // Тач-тап по-прежнему открывает карточку родителя.
  const startEdit = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    e.preventDefault();
    setValue(subtask.title);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const commit = () => {
    const t = value.trim();
    setEditing(false);
    if (t && t !== subtask.title) onRename?.(subtask, t);
  };

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => {
        // Клик по чекбоксу/кнопке — их обработчики; остальное открывает
        // карточку родительской задачи.
        const t = e.target as HTMLElement;
        if (t.closest("input, button, label")) return;
        onOpenCard?.();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "1px 0",
        opacity: isDragging ? 0.4 : undefined,
        // Шрифт строки = шрифт текста подзадачи: чекбокс (1em) не должен
        // вырастать больше текста (подзадача «больше самой задачи»).
        fontSize: "var(--fs-2xs)",
      }}
      {...attributes}
    >
      {/* Ручка перетаскивания подзадачи: listeners ТОЛЬКО тут, чтобы чекбокс и
          кнопку ✕ можно было кликать. Явная подсказка «тяни тут». */}
      <span
        {...listeners}
        title="Перетащите на день (→ задача) или на другую задачу"
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
      <label className="checkbox-hit">
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
            fontSize: "var(--fs-2xs)",
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
          title={subtask.title || undefined}
          style={{
            flex: 1,
            fontSize: "var(--fs-2xs)",
            color: subtask.isDone ? COLORS.muted : COLORS.text,
            textDecoration: subtask.isDone ? "line-through" : "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "text",
          }}
        >
          {subtask.title}
        </span>
      )}
      <button onClick={onDelete} className="chip-btn" title="Удалить">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
