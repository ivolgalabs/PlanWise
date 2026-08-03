import { useEffect, useRef, useState } from "react";
import type { Task } from "../api";
import { fromEpochDay } from "../api";
import { weekDays, isSameDay } from "../date";
import { DayColumn } from "../components/DayColumn";
import { WeekShiftZone } from "../components/WeekShiftZone";
import { WeekViewVertical } from "./WeekViewVertical";
import { Icon } from "../components/Icon";
import { RightPanel } from "../components/RightPanel";
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
  const { selectedDate, mondayFirst, setSelectedDate, visibility } = useStore();
  const [vertical, setVertical] = useState(true);
  const [showCalendar, setShowCalendar] = useState(true);
  const [calWidth, setCalWidth] = useState<number>(loadCalWidth);
  const days = weekDays(selectedDate, mondayFirst);
  // Эффективная видимость панели: локальный переключатель И хотя бы одна
  // секция (календарь или «Когда-нибудь») включена настройками.
  const showPanel = showCalendar && (visibility.miniCalendar || visibility.someday);

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
  // Окно без достаточной ширины для календаря рядом с сеткой: календарь
  // автоскрывается (кнопка в тулбаре остаётся). Порог 1200px — при нём сетка
  // (7 колонок по мин. 140px ≈ 1052px + зоны сдвига) влезает без скролла;
  // с календарём (300px) на 1200 колонка «сегодня» уходила бы под панель.
  const [calNarrow, setCalNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1200px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1200px)");
    const handler = (e: MediaQueryListEvent) => setCalNarrow(e.matches);
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
            showCalendar={showPanel}
            onToggleCalendar={() => setShowCalendar((v) => !v)}
            calendarVisible={visibility.miniCalendar || visibility.someday}
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            {effectiveVertical ? (
              <WeekViewVertical tasks={tasks} onChange={onChange} />
            ) : (
              <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
                <WeekShiftZone dir={-1} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4, flex: 1, minWidth: 0, height: "100%", minHeight: 0 }}>
                  {/* Два ряда: Пн–Чт сверху, Пт–Вс снизу. Колонки равные и
                      широкие — текст задач читается без обрезки. */}
                  {[days.slice(0, 4), days.slice(4)].map((row, ri) => (
                    <div key={ri} style={{ display: "flex", gap: 4, flex: 1, minHeight: 0 }}>
                      {row.map((d) => (
                        <div key={d.toISOString()} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                          <DayColumn day={d} tasks={tasksForDay(d)} onChange={onChange} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <WeekShiftZone dir={1} />
              </div>
            )}
          </div>
        </div>
        {/* Правая панель: календарь + «Когда-нибудь» + архив. Скрывается
            кнопкой тулбара, настройками видимости и в узком окне. */}
        {showPanel && !narrow && !calNarrow && (
          <RightCalendar
            width={calWidth}
            onResize={setCalWidth}
            tasks={tasks}
            onSelect={setSelectedDate}
            onChange={onChange}
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
  calendarVisible,
}: {
  vertical: boolean;
  /** false в узком окне — кнопку ориентации прячем (сетка всё равно нечитаема). */
  canToggle: boolean;
  onToggleOrientation: () => void;
  showCalendar: boolean;
  onToggleCalendar: () => void;
  /** Настройки видимости панели («Мини-календарь» или «Когда-нибудь») —
   *  false прячет кнопку. */
  calendarVisible: boolean;
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
          style={{
            fontSize: "var(--fs-xs)",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
          }}
        >
          {vertical ? (
            <><Icon name="grid" size={14} /> сеткой</>
          ) : (
            <><Icon name="list" size={14} /> списком</>
          )}
        </button>
      )}
      {calendarVisible && (
        <button
          onClick={onToggleCalendar}
          className="icon-btn"
          title={showCalendar ? "Скрыть панель" : "Показать панель"}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}
        >
          {showCalendar ? <Icon name="calendarHide" size={14} /> : <Icon name="calendar" size={14} />}
        </button>
      )}
    </div>
  );
}

/** Правая панель недели: resize-handle + общий RightPanel (календарь,
 *  «Когда-нибудь», архив). */
function RightCalendar({
  width,
  onResize,
  tasks,
  onSelect,
  onChange,
}: {
  width: number;
  onResize: (w: number) => void;
  tasks: Task[];
  onSelect: (d: Date) => void;
  onChange: () => void;
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
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Drag-handle для изменения ширины. Сиблинг контента, чтобы его не
          обрезал внутренний скролл. */}
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
      <RightPanel tasks={tasks} onSelect={onSelect} onChange={onChange} />
    </div>
  );
}
