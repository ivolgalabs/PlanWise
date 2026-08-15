/**
 * Общая drag-инфраструктура на @dnd-kit/core.
 *
 * Идентификаторы:
 *  - Droppable день:     dayId(epochDay)  → "d:739000"
 *  - Droppable задача:   taskIdZone(id)   → "t:<uuid>" (цель для прикрепления подзадачи)
 *  - Draggable задача:   id = task.id,             data = { task }
 *  - Draggable подзадача: subtaskDragId(id) → "s:<uuid>", data = { subtask, taskId }
 *
 * Поддерживаемые операции drag:
 *  - task → день:            moveTask (перенос задачи на другой день)
 *  - subtask → день:         promote (подзадача → самостоятельная задача этого дня)
 *  - subtask → задача:       attach (сменить родителя подзадачи)
 *  - subtask → день (та же): подтверждение перед promote
 */
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { Task, Subtask } from "./api";
import { api } from "./api";
import { fromEpochDay } from "./api";
import { COLORS, setHex as setHexOf } from "./theme";
import { useStore } from "./store";

/** id droppable-зоны дня по epoch-day (основные зоны: колонки/строки/ячейки). */
export const dayId = (epochDay: number): string => `d:${epochDay}`;

/** id droppable-ячейки дня в мини-календаре (отдельное пространство имён,
 *  чтобы не конфликтовать с основными зонами того же дня — иначе @dnd-kit
 *  перезаписывает ref и drag ломается). */
export const calendarDayId = (epochDay: number): string => `dc:${epochDay}`;

/** Распарсить epoch-day из id droppable-зоны дня (d: или dc:). null иначе. */
export const parseDayId = (id: string | number | undefined | null): number | null => {
  if (id == null) return null;
  const s = String(id);
  let rest: string | null = null;
  if (s.startsWith("d:")) rest = s.slice(2);
  else if (s.startsWith("dc:")) rest = s.slice(3);
  else return null;
  const n = Number(rest);
  return Number.isFinite(n) ? n : null;
};

/** id droppable-зоны задачи (цель для прикрепления подзадачи). */
export const taskIdZone = (taskId: string): string => `t:${taskId}`;

/** id боковой зоны переноса на следующую неделю (+7 дней от позиции задачи).
 *  Зоны переноса в прошлую неделю нет — убрана по желанию пользователя. */
export const weekShiftNextId = "w:next";

/** id droppable-зоны «Когда-нибудь» (колонка задач без даты). */
export const somedayZoneId = "sd:someday";

/** Распарсить id задачи-цели из droppable-зоны. null, если это не задача. */
export const parseTaskZone = (id: string | number | undefined | null): string | null => {
  if (id == null) return null;
  const s = String(id);
  if (!s.startsWith("t:")) return null;
  return s.slice(2) || null;
};

/** id draggable-подзадачи. */
export const subtaskDragId = (subtaskId: string): string => `s:${subtaskId}`;

// Опции сенсоров — модульные константы: useSensor мемоизирует результат по
// [Sensor, options], и литерал прямо в рендере ломал мемоизацию → sensors
// пересоздавались при каждом рендере провайдера → activators → dnd-контекст
// → ре-рендер ВСЕХ useDraggable/useDroppable (всех строк задач) на любое
// изменение стора, минуя memo карточек. Константа держит ссылку стабильной.
const MOUSE_SENSOR_OPTIONS = {
  activationConstraint: { distance: 5 },
};
const TOUCH_SENSOR_OPTIONS = {
  activationConstraint: { delay: 120, tolerance: 12 },
};

interface TaskDndContextProps {
  children: ReactNode;
  /** Колбэк после успешного переноса/преобразования (обычно reload). */
  onChange: () => void;
}

type Pending = { kind: "promote"; subtask: Subtask; date: number } | null;

/**
 * Кастомное определение столкновений:
 *  - сначала pointerWithin (что строго под курсором) — точно для месяца;
 *  - если указатель не над зоной (pointerCoordinates null / вне зон) —
 *    closestCenter по collisionRect (надёжно в WKWebView, где pointer-события
 *    капризны). У источника drag исключены его день и собственная обёртка,
 *    чтобы ближайшей не оказывалась она сама.
 *
 * Исключения источника:
 *  - подзадача: её родитель и сама подзадача;
 *  - задача: исходный день и droppable-обёртка самой задачи (TaskCard).
 */
const customCollision: CollisionDetection = (args) => {
  const active = args.active;
  const subtask = active.data.current?.subtask as Subtask | undefined;
  const task = active.data.current?.task as Task | undefined;

  // Множество id droppable-зон, которые надо исключить.
  const exclude = new Set<string>();
  if (subtask) {
    exclude.add(taskIdZone(subtask.taskId)); // родитель подзадачи
    exclude.add(subtaskDragId(subtask.id)); // сама подзадача
  }
  if (task) {
    exclude.add(dayId(task.date)); // исходный день задачи (основная зона)
    exclude.add(calendarDayId(task.date)); // и ячейка календаря того же дня
    exclude.add(taskIdZone(task.id)); // droppable-обёртка САМОЙ задачи
  }

  const filtered = {
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => {
      const cid = String(c.id);
      if (exclude.has(cid)) return false;
      // Задачу можно бросить только в ДЕНЬ (d: или dc:). Droppable-обёртки
      // других задач (t:*) не должны быть целью — иначе ближайшей оказывается
      // соседняя задача, и перенос блокируется (parseDayId("t:...") = null).
      if (task && cid.startsWith("t:")) return false;
      return true;
    }),
  };

  // Сначала точно под курсором; если ничего — пересечение прямоугольников
  // (rectIntersection точнее closestCenter для плотных сеток месяца).
  const exact = pointerWithin(filtered);
  if (exact.length > 0) return exact;
  return rectIntersection(filtered);
};

/**
 * DndContext с настроенным PointerSensor (активация drag после сдвига 8px) и
 * DragOverlay. Поддерживает перенос задач и подзадач (с подтверждением promote).
 */
export function TaskDndContext({ children, onChange }: TaskDndContextProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeSubtask, setActiveSubtask] = useState<Subtask | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  // MouseSensor + TouchSensor вместо PointerSensor: в WKWebView (Tauri на macOS)
  // pointer-события капризны — pointerCoordinates может быть null, и pointerWithin
  // ничего не находит. MouseSensor/TouchSensor опираются на mouse/touch events
  // напрямую, координаты всегда валидны.
  // Touch: задержка 120мс + допуск 12px — палец успевает слегка поехать при
  // «взятии» строки, и drag не отменяется (150/8 отменял почти каждый захват).
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
  );

  // Колбэки DndContext — СТРОГО useCallback: dnd-kit кладёт их в deps цепочки
  // активаторов сенсоров, и новый референс при каждом рендере этого провайдера
  // пересоздавал internalContext → ре-рендер ВСЕХ useDraggable/useDroppable
  // (все строки задач) на любое изменение стора, минуя memo карточек.
  const onDragStart = useCallback((e: DragStartEvent) => {
    const task = e.active.data.current?.task as Task | undefined;
    const subtask = e.active.data.current?.subtask as Subtask | undefined;
    if (task) setActiveTask(task);
    else if (subtask) setActiveSubtask(subtask);
  }, []);

  // useCallback: см. комментарий у onDragStart.
  const onDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveTask(null);
    setActiveSubtask(null);
    const over = e.over?.id;
    const task = e.active.data.current?.task as Task | undefined;
    const subtask = e.active.data.current?.subtask as Subtask | undefined;

    // ── Задача → день: перенос задачи.
    if (task) {
      // Задача → «Когда-нибудь»: снять привязку ко дню.
      if (over === somedayZoneId) {
        await api.setSomeday(task.id);
        onChange();
        return;
      }
      // Боковая зона «следующая неделя»: перенос на +7 дней от позиции задачи.
      if (over === weekShiftNextId) {
        await api.moveTask(task.id, fromEpochDay(task.date + 7));
        onChange();
        return;
      }
      const targetDay = parseDayId(over);
      if (targetDay == null || task.date === targetDay) return;
      await api.moveTask(task.id, fromEpochDay(targetDay));
      onChange();
      return;
    }

    // ── Подзадача → задача: сменить родителя (прикрепить к другой задаче).
    if (subtask) {
      const targetTaskId = parseTaskZone(over);
      if (targetTaskId) {
        if (targetTaskId === subtask.taskId) return; // тот же родитель
        await api.upsertSubtask({ ...subtask, taskId: targetTaskId });
        // Списки подзадач обоих родителей должны перечитаться (у старого
        // родителя подзадача исчезает, у нового — появляется).
        useStore.getState().bumpSubtasks();
        onChange();
        return;
      }
      // ── Подзадача → день: promote (с подтверждением).
      const targetDay = parseDayId(over);
      if (targetDay == null) return;
      // Требуется подтверждение: подзадача станет самостоятельной задачей.
      setPending({ kind: "promote", subtask, date: targetDay });
      return;
    }
  }, [onChange]);

  // Выполнить promote после подтверждения пользователя.
  const confirmPromote = async () => {
    if (!pending) return;
    const { subtask, date } = pending;
    setPending(null);
    // Создаём самостоятельную задачу из подзадачи, затем удаляем подзадачу.
    await api.upsertTask({
      title: subtask.title,
      date,
      isDone: subtask.isDone,
      sortOrder: Date.now(),
    });
    await api.deleteSubtask(subtask.id);
    // Перечитаем списки подзадач: у старого родителя промоутнутая подзадача
    // не должна оставаться висеть до перезагрузки приложения.
    useStore.getState().bumpSubtasks();
    onChange();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // useCallback: см. комментарий у onDragStart.
      onDragCancel={useCallback(() => {
        setActiveTask(null);
        setActiveSubtask(null);
      }, [])}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <DragGhost task={activeTask} />
        ) : activeSubtask ? (
          <SubtaskGhost subtask={activeSubtask} />
        ) : null}
      </DragOverlay>

      {/* Диалог подтверждения promote подзадачи в задачу. */}
      {pending && (
        <div
          className="modal-overlay"
          onClick={() => setPending(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: COLORS.card,
              border: `1px solid var(--border-color)`,
              borderRadius: "var(--radius-md)",
              padding: "var(--sp-6)",
              width: 320,
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <h3 style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-md)", color: COLORS.text }}>
              Сделать задачей?
            </h3>
            <p style={{ margin: "0 0 var(--sp-4)", fontSize: "var(--fs-sm)", color: COLORS.secondary, lineHeight: 1.4 }}>
              Подзадача <strong>«{pending.subtask.title}»</strong> станет
              самостоятельной задачей на{" "}
              {fromEpochDay(pending.date).toLocaleDateString("ru", {
                day: "numeric",
                month: "long",
              })}
              .
            </p>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button
                className="modal-action-btn"
                onClick={() => setPending(null)}
                style={{ flex: 1 }}
              >
                Отмена
              </button>
              <button
                className="modal-action-btn primary"
                onClick={confirmPromote}
                style={{ flex: 1, fontWeight: 600 }}
              >
                Сделать задачей
              </button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}

/** Компактный «призрак» перетаскиваемой задачи. */
function DragGhost({ task }: { task: Task }) {
  const { colorSets } = useStore();
  const setHex = setHexOf(colorSets, task.colorSetId) ?? "transparent";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "6px 10px",
        maxWidth: 280,
        background: COLORS.card,
        border: `1px solid var(--border-color)`,
        borderRadius: "var(--radius-md)",
        boxShadow: "0 4px 14px rgba(0,0,0,.18)",
        opacity: 0.92,
      }}
    >
      <div
        style={{
          width: 3,
          alignSelf: "stretch",
          borderRadius: 2,
          background: task.colorSetId ? setHex : "transparent",
        }}
      />
      <span
        style={{
          fontSize: 13,
          color: task.isDone ? COLORS.muted : COLORS.text,
          textDecoration: task.isDone ? "line-through" : "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {task.title || "(пустая задача)"}
      </span>
    </div>
  );
}

/** «Призрак» перетаскиваемой подзадачи. */
function SubtaskGhost({ subtask }: { subtask: Subtask }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "5px 10px",
        maxWidth: 260,
        background: COLORS.card,
        border: `1px dashed ${COLORS.accent}`,
        borderRadius: "var(--radius-md)",
        boxShadow: "0 4px 14px rgba(0,0,0,.18)",
        opacity: 0.92,
        fontSize: 12,
        color: subtask.isDone ? COLORS.muted : COLORS.text,
        textDecoration: subtask.isDone ? "line-through" : "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      ↳ {subtask.title}
    </div>
  );
}
