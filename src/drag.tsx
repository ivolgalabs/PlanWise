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
import { useState } from "react";
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

/** id боковой зоны переноса на соседнюю неделю (±7 дней от позиции задачи). */
export const weekShiftId = (dir: 1 | -1): string =>
  dir === 1 ? "w:next" : "w:prev";

/** Распарсить id задачи-цели из droppable-зоны. null, если это не задача. */
export const parseTaskZone = (id: string | number | undefined | null): string | null => {
  if (id == null) return null;
  const s = String(id);
  if (!s.startsWith("t:")) return null;
  return s.slice(2) || null;
};

/** id draggable-подзадачи. */
export const subtaskDragId = (subtaskId: string): string => `s:${subtaskId}`;

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
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const task = e.active.data.current?.task as Task | undefined;
    const subtask = e.active.data.current?.subtask as Subtask | undefined;
    if (task) setActiveTask(task);
    else if (subtask) setActiveSubtask(subtask);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveTask(null);
    setActiveSubtask(null);
    const over = e.over?.id;
    const task = e.active.data.current?.task as Task | undefined;
    const subtask = e.active.data.current?.subtask as Subtask | undefined;

    // ── Задача → день: перенос задачи.
    if (task) {
      // Боковые зоны «соседняя неделя»: перенос на ±7 дней от позиции задачи.
      if (over === "w:prev" || over === "w:next") {
        const dir = over === "w:next" ? 1 : -1;
        await api.moveTask(task.id, fromEpochDay(task.date + 7 * dir));
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
  };

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
    onChange();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveTask(null);
        setActiveSubtask(null);
      }}
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
          onClick={() => setPending(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
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
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: "var(--radius-xl)",
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
                onClick={() => setPending(null)}
                style={{
                  flex: 1,
                  padding: "var(--sp-2) var(--sp-3)",
                  cursor: "pointer",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${COLORS.cardBorder}`,
                  background: "transparent",
                  color: COLORS.text,
                  fontSize: "var(--fs-sm)",
                }}
              >
                Отмена
              </button>
              <button
                onClick={confirmPromote}
                style={{
                  flex: 1,
                  padding: "var(--sp-2) var(--sp-3)",
                  cursor: "pointer",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${COLORS.accent}`,
                  background: COLORS.accent,
                  color: "#fff",
                  fontSize: "var(--fs-sm)",
                  fontWeight: 600,
                }}
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
        gap: 6,
        padding: "6px 10px",
        maxWidth: 280,
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 6,
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
        gap: 6,
        padding: "5px 10px",
        maxWidth: 260,
        background: COLORS.card,
        border: `1px dashed ${COLORS.accent}`,
        borderRadius: 6,
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
