import { useEffect } from "react";
import type { Task } from "../api";
import { MiniCalendar } from "./MiniCalendar";

interface Props {
  tasks: Task[];
  onPick: (d: Date) => void;
  onClose: () => void;
}

/** Модалка выбора даты: крупный мини-календарь с точками задач.
 *  Переиспользует MiniCalendar — единый источник правды для подсветок,
 *  навигации по месяцам и кнопки «Сегодня». Escape закрывает. */
export function DatePickerModal({ tasks, onPick, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{ zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: "92vw" }}
      >
        {/* droppable=false: в модалке drag не нужен, ячейки не должны
            перехватывать dnd-события. onSelect → onPick (выбор даты)
            + onClose: выбор дня закрывает модалку. */}
        <MiniCalendar
          tasks={tasks}
          large
          onSelect={(d) => {
            onPick(d);
            onClose();
          }}
          droppable={false}
        />
      </div>
    </div>
  );
}
