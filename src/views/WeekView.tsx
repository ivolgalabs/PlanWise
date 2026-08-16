import { useEffect } from "react";
import type { Task } from "../api";
import { weekDays, tasksForDay } from "../date";
import { DayColumn } from "../components/DayColumn";
import { WeekShiftZone } from "../components/WeekShiftZone";
import { WeekViewVertical } from "./WeekViewVertical";
import { useStore } from "../store";
import { useMediaQuery } from "../useMediaQuery";

interface Props {
  tasks: Task[];
  /** Архивные задачи — нужны для доступа к архиву на мобильном (внизу недели). */
  archivedTasks: Task[];
  onChange: () => void;
}

/**
 * Вид «Неделя»: дни + (опциональная) правая панель с календарём.
 * Кнопка ориентации (список/сетка) меняет сохранённую настройку weekVertical;
 * кнопка скрытия панели убрана по желанию пользователя.
 * Панель и drag-контекст — на уровне App; здесь только сетка дней.
 */
export function WeekView({ tasks, archivedTasks, onChange }: Props) {
  const selectedDate = useStore((s) => s.selectedDate);
  const weekDate = useStore((s) => s.weekDate);
  const setWeekDate = useStore((s) => s.setWeekDate);
  const mondayFirst = useStore((s) => s.mondayFirst);
  const weekVertical = useStore((s) => s.weekVertical);
  const sortMode = useStore((s) => s.sortMode);
  // Якорь недели: фиксируем при первом открытии вида (позже клики в «Дне»
  // не будут двигать неделю — см. store.ts weekDate).
  useEffect(() => {
    if (weekDate === null) setWeekDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const days = weekDays(weekDate ?? selectedDate, mondayFirst);

  // В узком окне принудительно вертикальный список — сетка из 7 узких колонок
  // нечитаема. useMediaQuery реагирует на ресайз окна (общий listener).
  const narrow = useMediaQuery("(max-width: 820px)");
  // Правая панель скрыта при <1000px (тот же порог, что в App): в этой полосе
  // «Когда-нибудь» и «Архив» должны дублироваться внизу списка недели.
  const mobileSections = useMediaQuery("(max-width: 1000px)");
  // Вертикаль, если выбрано настройкой ИЛИ окно узкое.
  const effectiveVertical = weekVertical || narrow;

  return (
    // flex:1 вместо height:100% — см. DayView (zoom-совместимость).
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* minHeight 0 обязателен: иначе колонка растёт по контенту недели,
          внутренний скролл не появляется и задачи не пролистать. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Обёртка контента — flex-колонка: иначе блочный div растёт по
            контенту недели (flex:1 у WeekViewVertical не работает без
            flex-контекста) и внутренний скролл не появляется. */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {effectiveVertical ? (
            <WeekViewVertical
              tasks={tasks}
              archivedTasks={archivedTasks}
              mobileSections={mobileSections}
              anchor={weekDate ?? selectedDate}
              onChange={onChange}
            />
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
                        <DayColumn day={d} tasks={tasksForDay(tasks, d, sortMode)} onChange={onChange} />
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

