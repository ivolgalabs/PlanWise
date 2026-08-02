import type { ViewKind } from "../store";
import { ViewSwitcher } from "./ViewSwitcher";
import { Icon } from "./Icon";
import { COLORS } from "../theme";
import { weekDays } from "../date";

interface Props {
  selectedDate: Date;
  view: ViewKind;
  mondayFirst: boolean;
  onViewChanged: (v: ViewKind) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpenSettings: () => void;
  onOpenDatePicker: () => void;
  /** Поиск: открыт ли, переключение. */
  searchActive: boolean;
  onToggleSearch: () => void;
}

/** Шапка: навигация (стрелки), заголовок периода, switcher, кнопки настроек/даты. */
export function TopBar({
  selectedDate,
  view,
  mondayFirst,
  onViewChanged,
  onPrev,
  onNext,
  onOpenSettings,
  onOpenDatePicker,
  searchActive,
  onToggleSearch,
}: Props) {
  let label: string;
  if (view === "day") {
    label = selectedDate.toLocaleDateString("ru", {
      day: "numeric",
      month: "long",
    });
  } else if (view === "week") {
    const days = weekDays(selectedDate, mondayFirst);
    label = `${days[0].getDate()}–${days[6].getDate()} ${days[6].toLocaleDateString("ru", { month: "long" })}`;
  } else {
    label = selectedDate.toLocaleDateString("ru", {
      month: "long",
      year: "numeric",
    });
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 12px",
        gap: 8,
      }}
    >
      <button className="icon-btn" onClick={onPrev} title="Назад">
        <Icon name="chevronL" size={18} />
      </button>
      <button
        onClick={onOpenDatePicker}
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: COLORS.text,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textTransform: "capitalize",
        }}
        title="Выбрать дату"
      >
        {label}
      </button>
      <button className="icon-btn" onClick={onNext} title="Вперёд">
        <Icon name="chevronR" size={18} />
      </button>
      <div style={{ flex: 1 }} />
      <ViewSwitcher view={view} onChange={onViewChanged} />
      <button
        className="icon-btn"
        onClick={onToggleSearch}
        title={searchActive ? "Закрыть поиск" : "Поиск задач"}
        style={searchActive ? { background: COLORS.hover } : undefined}
      >
        <Icon name="search" />
      </button>
      <button className="icon-btn" onClick={onOpenDatePicker} title="Дата">
        <Icon name="calendar" />
      </button>
      <button className="icon-btn" onClick={onOpenSettings} title="Настройки">
        <Icon name="gear" />
      </button>
    </div>
  );
}
