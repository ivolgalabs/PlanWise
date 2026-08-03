import { useEffect, useState } from "react";
import type { Task } from "../api";
import { fromEpochDay } from "../api";
import { weekDays, isSameDay } from "../date";
import { DayColumn } from "../components/DayColumn";
import { WeekShiftZone } from "../components/WeekShiftZone";
import { WeekViewVertical } from "./WeekViewVertical";
import { Icon } from "../components/Icon";
import { useStore } from "../store";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/**
 * Вид «Неделя»: дни + (опциональная) правая панель с календарём.
 * Кнопка ориентации (список/сетка) меняет сохранённую настройку weekVertical;
 * кнопка скрытия панели убрана по желанию пользователя.
 * Панель и drag-контекст — на уровне App; здесь только сетка дней.
 */
export function WeekView({ tasks, onChange }: Props) {
  const { selectedDate, weekDate, setWeekDate, mondayFirst, weekVertical, setWeekVertical } = useStore();
  // Якорь недели: фиксируем при первом открытии вида (позже клики в «Дне»
  // не будут двигать неделю — см. store.ts weekDate).
  useEffect(() => {
    if (weekDate === null) setWeekDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const days = weekDays(weekDate ?? selectedDate, mondayFirst);

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
  // Вертикаль, если выбрано настройкой ИЛИ окно узкое.
  const effectiveVertical = weekVertical || narrow;

  const tasksForDay = (d: Date) =>
    tasks.filter((t) => isSameDay(fromEpochDay(t.date), d));

  return (
    // flex:1 вместо height:100% — см. DayView (zoom-совместимость).
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Toolbar
          vertical={effectiveVertical}
          canToggle={!narrow}
          onToggleOrientation={() => setWeekVertical(!weekVertical)}
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          {effectiveVertical ? (
            <WeekViewVertical tasks={tasks} onChange={onChange} />
          ) : (
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              {/* Зона «следующая неделя» — только справа; перенос в прошлую
                  неделю убран по желанию пользователя. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4, flex: 1, minWidth: 0, minHeight: 0 }}>
                {/* Два ряда: Пн–Чт сверху, Пт–Вс снизу. Колонки равные и
                    широкие — текст задач читается без обрезки. */}
                {[days.slice(0, 4), days.slice(4)].map((row, ri) => (
                  <div key={ri} style={{ display: "flex", gap: 4, flex: 1, minHeight: 0 }}>
                    {row.map((d) => (
                      <div key={d.toISOString()} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                        <DayColumn day={d} tasks={tasksForDay(d)} onChange={onChange} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <WeekShiftZone />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Панель кнопок недели: только ориентация (список/сетка). */
function Toolbar({
  vertical,
  canToggle,
  onToggleOrientation,
}: {
  vertical: boolean;
  /** false в узком окне — кнопку ориентации прячем (сетка всё равно нечитаема). */
  canToggle: boolean;
  onToggleOrientation: () => void;
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
    </div>
  );
}

