import { useLayoutEffect, useRef, useState } from "react";
import type { ViewKind, VisibilityState } from "../store";
import { ViewSwitcher } from "./ViewSwitcher";
import { Icon } from "./Icon";
import { COLORS } from "../theme";
import { weekDays } from "../date";
import { useI18n } from "../i18n";

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
  const { t, lang } = useI18n();
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
    label = selectedDate.toLocaleDateString(lang, {
      day: "numeric",
      month: "long",
    });
  } else if (view === "week") {
    const days = weekDays(selectedDate, mondayFirst);
    label = `${days[0].getDate()}–${days[6].getDate()} ${days[6].toLocaleDateString(lang, { month: "long" })}`;
  } else {
    label = selectedDate.toLocaleDateString(lang, {
      month: "long",
      year: "numeric",
    });
  }

  return (
    <div ref={barRef} className={`top-bar${crowded ? " crowded" : ""}`}>
      {/* Стрелки/кнопка 📅 скрываются по настройкам видимости; заголовок-дата
          и кнопка настроек (gear) остаются всегда. */}
      {visibility.navArrows && (
        <button className="icon-btn" onClick={onPrev} title={t("topBar.prev")}>
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
        title={t("topBar.pickDate")}
      >
        {label}
      </button>
      {visibility.navArrows && (
        <button className="icon-btn" onClick={onNext} title={t("topBar.next")}>
          <Icon name="chevronR" size={18} />
        </button>
      )}
      <div className="top-bar-spacer" />
      <ViewSwitcher view={view} onChange={onViewChanged} />
      {showWeekToggle && onToggleWeekOrientation && (
        <button
          className="text-chip week-toggle-btn"
          onClick={onToggleWeekOrientation}
          title={weekVertical ? t("topBar.gridTitle") : t("topBar.listTitle")}
          aria-label={weekVertical ? t("topBar.gridAria") : t("topBar.listAria")}
          style={{ fontSize: "var(--fs-xs)" }}
        >
          {weekVertical ? (
            <><Icon name="grid" size={14} /> {t("topBar.gridLabel")}</>
          ) : (
            <><Icon name="list" size={14} /> {t("topBar.listLabel")}</>
          )}
        </button>
      )}
      {visibility.search && (
        <button
          className="icon-btn search-btn"
          onClick={onToggleSearch}
          title={searchActive ? t("topBar.closeSearch") : t("topBar.search")}
          style={searchActive ? { background: COLORS.hover } : undefined}
        >
          <Icon name="search" />
        </button>
      )}
      {/* Кнопка-дубль заголовка (тот тоже открывает календарь). На мобиле
          шапка двухстрочная — кнопка показывается на 1-й строке рядом с ⚙. */}
      {visibility.datePicker && (
        <button
          className="icon-btn"
          onClick={onOpenDatePicker}
          title={t("topBar.date")}
        >
          <Icon name="calendar" />
        </button>
      )}
      <button className="icon-btn" onClick={onOpenSettings} title={t("topBar.settings")}>
        <Icon name="gear" />
      </button>
    </div>
  );
}
