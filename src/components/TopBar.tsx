import { useLayoutEffect, useRef, useState } from "react";
import type { ViewKind, VisibilityState } from "../store";
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
  /** Флаги видимости кнопок (настройки → «Интерфейс»). */
  visibility: VisibilityState;
  /** Вид «Неделя»: показывать ли toggle «сеткой/списком». Показываем только
   *  в виде недели и в достаточно широком окне (на узком сетка нечитаема,
   *  список принудителен — кнопку не показываем, как раньше в Toolbar недели). */
  showWeekToggle?: boolean;
  /** Текущее состояние ориентации недели (true = вертикальный список). */
  weekVertical?: boolean;
  onToggleWeekOrientation?: () => void;
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
  visibility,
  showWeekToggle = false,
  weekVertical = false,
  onToggleWeekOrientation,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  // Переполнение шапки (крупный масштаб/шрифт): сравниваем сумму ширин
  // детей с шириной шапки (scrollWidth не годится — flex-wrap уже перенёс
  // элементы, переполнения нет). При переполнении переносим переключатель
  // вида и поиск на вторую строку, чтобы кнопка настроек осталась на первой.
  const [crowded, setCrowded] = useState(false);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const check = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
      const total = [...el.children].reduce(
        (s, c) => s + c.getBoundingClientRect().width,
        0,
      );
      setCrowded(total + gap * (el.children.length - 1) > el.clientWidth + 4);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // Пересчитываем при смене вида и видимости кнопок: длина заголовка
    // («5 августа» vs «август 2026») и число детей меняются — иначе crowded
    // оставался от прошлого вида и шапка «прыгала» по высоте при переключении.
  }, [view, visibility.navArrows, visibility.search, visibility.datePicker, showWeekToggle]);
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
    <div ref={barRef} className={`top-bar${crowded ? " crowded" : ""}`}>
      {/* Стрелки/кнопка 📅 скрываются по настройкам видимости; заголовок-дата
          и кнопка настроек (gear) остаются всегда. */}
      {visibility.navArrows && (
        <button className="icon-btn" onClick={onPrev} title="Назад">
          <Icon name="chevronL" size={18} />
        </button>
      )}
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
          // Заголовок умеет сжиматься (многоточие) — иначе на узком экране
          // кнопки шапки выталкиваются за правый край (настройки уезжали).
          flex: "0 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title="Выбрать дату"
      >
        {label}
      </button>
      {visibility.navArrows && (
        <button className="icon-btn" onClick={onNext} title="Вперёд">
          <Icon name="chevronR" size={18} />
        </button>
      )}
      <div style={{ flex: 1 }} />
      <ViewSwitcher view={view} onChange={onViewChanged} />
      {showWeekToggle && onToggleWeekOrientation && (
        <button
          className="icon-btn week-toggle-btn"
          onClick={onToggleWeekOrientation}
          title={weekVertical ? "Сетка (горизонтально)" : "Список (вертикально)"}
          aria-label={weekVertical ? "Показать неделю сеткой" : "Показать неделю списком"}
          style={{
            fontSize: "var(--fs-xs)",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
          }}
        >
          {weekVertical ? (
            <><Icon name="grid" size={14} /> сеткой</>
          ) : (
            <><Icon name="list" size={14} /> списком</>
          )}
        </button>
      )}
      {visibility.search && (
        <button
          className="icon-btn search-btn"
          onClick={onToggleSearch}
          title={searchActive ? "Закрыть поиск" : "Поиск задач"}
          style={searchActive ? { background: COLORS.hover } : undefined}
        >
          <Icon name="search" />
        </button>
      )}
      {/* Кнопка-дубль заголовка (тот тоже открывает календарь) — на мобильном
          скрыта, чтобы шапка умещалась в узкий экран. */}
      {visibility.datePicker && (
        <button
          className="icon-btn hide-on-mobile"
          onClick={onOpenDatePicker}
          title="Дата"
        >
          <Icon name="calendar" />
        </button>
      )}
      <button className="icon-btn" onClick={onOpenSettings} title="Настройки">
        <Icon name="gear" />
      </button>
    </div>
  );
}
