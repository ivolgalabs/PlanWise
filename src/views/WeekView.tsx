import { useEffect, useRef, useState } from "react";
import type { Task } from "../api";
import { fromEpochDay } from "../api";
import { weekDays, isSameDay, dayWeight } from "../date";
import { DayColumn } from "../components/DayColumn";
import { MiniCalendar } from "../components/MiniCalendar";
import { WeekShiftZone } from "../components/WeekShiftZone";
import { WeekViewVertical } from "./WeekViewVertical";
import { COLORS } from "../theme";
import { useStore } from "../store";
import { TaskDndContext } from "../drag";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

const CAL_MIN = 200;
const CAL_MAX = 520;
const CAL_KEY = "week.calWidth";
const CAL_DEFAULT = 300;

function loadCalWidth(): number {
  const v = Number(localStorage.getItem(CAL_KEY));
  if (Number.isFinite(v) && v >= CAL_MIN && v <= CAL_MAX) return v;
  return CAL_DEFAULT;
}

/**
 * Вид «Неделя»: дни + (опциональная) правая панель с календарём.
 * Кнопки: переключение горизонтально/вертикально, скрыть/показать календарь.
 * Drag задач между днями — через @dnd-kit (TaskDndContext оборачивает всё).
 */
export function WeekView({ tasks, onChange }: Props) {
  const { selectedDate, mondayFirst, setSelectedDate } = useStore();
  const [vertical, setVertical] = useState(true);
  const [showCalendar, setShowCalendar] = useState(true);
  const [calWidth, setCalWidth] = useState<number>(loadCalWidth);
  const days = weekDays(selectedDate, mondayFirst);

  // В узком окне принудительно вертикальный список — сетка из 7 узких колонок
  // нечитаема. matchMedia реагирует на ресайз окна.
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // Вертикаль, если пользователь выбрал его ИЛИ окно узкое.
  const effectiveVertical = vertical || narrow;

  const tasksForDay = (d: Date) =>
    tasks.filter((t) => isSameDay(fromEpochDay(t.date), d));

  return (
    <TaskDndContext onChange={onChange}>
      <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Toolbar
            vertical={effectiveVertical}
            canToggle={!narrow}
            onToggleOrientation={() => setVertical((v) => !v)}
            showCalendar={showCalendar}
            onToggleCalendar={() => setShowCalendar((v) => !v)}
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            {effectiveVertical ? (
              <WeekViewVertical tasks={tasks} onChange={onChange} />
            ) : (
              <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
                <WeekShiftZone dir={-1} />
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    padding: 4,
                    flex: 1,
                    minWidth: 0,
                    height: "100%",
                    minHeight: 0,
                    alignItems: "stretch",
                    overflowX: "auto",
                  }}
                >
                  {days.map((d) => {
                    // Компактность как в месяце, но для колонок: прошедшие дни
                    // — узкие, сегодня/завтра — широкие, будущие — средние.
                    const w = dayWeight(d);
                    const flex =
                      w === "past"
                        ? "0 0 88px"
                        : w === "future"
                          ? "1 1 120px"
                          : "1.2 1 150px";
                    const maxW = w === "past" ? 120 : 320;
                    return (
                      <div
                        key={d.toISOString()}
                        style={{
                          flex,
                          minWidth: 0,
                          maxWidth: maxW,
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          minHeight: 0,
                        }}
                      >
                        <DayColumn
                          day={d}
                          tasks={tasksForDay(d)}
                          onChange={onChange}
                        />
                      </div>
                    );
                  })}
                </div>
                <WeekShiftZone dir={1} />
              </div>
            )}
          </div>
        </div>
        {/* Календарь скрыт в узком окне — он крадёт дефицитную ширину. */}
        {showCalendar && !narrow && (
          <RightCalendar
            width={calWidth}
            onResize={setCalWidth}
            tasks={tasks}
            onSelect={setSelectedDate}
          />
        )}
      </div>
    </TaskDndContext>
  );
}

/** Панель кнопок недели. */
function Toolbar({
  vertical,
  canToggle,
  onToggleOrientation,
  showCalendar,
  onToggleCalendar,
}: {
  vertical: boolean;
  /** false в узком окне — кнопку ориентации прячем (сетка всё равно нечитаема). */
  canToggle: boolean;
  onToggleOrientation: () => void;
  showCalendar: boolean;
  onToggleCalendar: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: "var(--sp-2)",
        padding: "var(--sp-1) var(--sp-4)",
      }}
    >
      {canToggle && (
        <button
          onClick={onToggleOrientation}
          className="icon-btn"
          title={vertical ? "Сетка (горизонтально)" : "Список (вертикально)"}
          style={{ fontSize: "var(--fs-xs)" }}
        >
          {vertical ? "▥ сеткой" : "▤ списком"}
        </button>
      )}
      <button
        onClick={onToggleCalendar}
        className="icon-btn"
        title={showCalendar ? "Скрыть календарь" : "Показать календарь"}
        style={{ fontSize: "var(--fs-xs)" }}
      >
        {showCalendar ? "▤⊨" : "▤"}
      </button>
    </div>
  );
}

/** Правая панель с крупным мини-календарём. Ширина регулируется drag-handle. */
function RightCalendar({
  width,
  onResize,
  tasks,
  onSelect,
}: {
  width: number;
  onResize: (w: number) => void;
  tasks: Task[];
  onSelect: (d: Date) => void;
}) {
  const draggingRef = useRef(false);

  // Resize мышью через drag-handle на левом краю панели.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      // Движение мыши влево увеличивает ширину (handle слева от панели).
      const next = Math.min(
        CAL_MAX,
        Math.max(CAL_MIN, startWidth + (startX - ev.clientX)),
      );
      onResize(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Сохраняем ширину при изменении.
  useEffect(() => {
    localStorage.setItem(CAL_KEY, String(width));
  }, [width]);

  return (
    <div
      style={{
        position: "relative",
        width,
        flexShrink: 0,
        borderLeft: `1px solid ${COLORS.cardBorder}`,
        // overflow: visible — иначе абсолютно позиционированный handle
        // с left:0 обрезался бы по границе скролл-контейнера.
      }}
    >
      {/* Drag-handle для изменения ширины. Сиблинг скролл-обёртки, чтобы
          overflow:auto внутреннего контейнера его не обрезал. */}
      <div
        onMouseDown={startResize}
        title="Тяните, чтобы изменить ширину"
        style={{
          position: "absolute",
          left: -3,
          top: 0,
          bottom: 0,
          width: 7,
          cursor: "col-resize",
          zIndex: 2,
        }}
      />
      {/* Внутренний скролл-контейнер: именно он скроллит содержимое. */}
      <div
        style={{
          height: "100%",
          overflowY: "auto",
          padding: "var(--sp-4)",
          minWidth: 0,
        }}
      >
        {/* Календарь снова droppable — теперь у ячеек префикс dc:, поэтому они
            не конфликтуют с основными зонами дней недели (d:). Можно
            перетащить задачу на любой день месяца через календарь. */}
        <MiniCalendar tasks={tasks} large onSelect={onSelect} />
      </div>
    </div>
  );
}
