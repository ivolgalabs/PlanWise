import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";
import { COLORS, applyTheme, watchSystemTheme, accentTint } from "./theme";
import { TopBar } from "./components/TopBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { DatePickerModal } from "./components/DatePickerModal";
import { SearchBar } from "./components/SearchBar";
import { Icon } from "./components/Icon";
import { SearchResults } from "./views/SearchResults";
import type { PeriodFilter, StatusFilter, SortKey } from "./views/SearchResults";
import { DayView } from "./views/DayView";
import { WeekView } from "./views/WeekView";
import { MonthView } from "./views/MonthView";
import "./App.css";

/** Разрешить id темы по mode + предпочтениям. */
function resolveActiveTheme(): string {
  const s = useStore.getState();
  if (s.themeMode === "light") return s.preferredLightTheme;
  if (s.themeMode === "dark") {
    return s.useOledForDarkMode
      ? s.preferredDarkTheme.replace(/^(dark|light)-/, "oled-")
      : s.preferredDarkTheme;
  }
  // system
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return isDark
    ? s.useOledForDarkMode
      ? s.preferredDarkTheme.replace(/^(dark|light)-/, "oled-")
      : s.preferredDarkTheme
    : s.preferredLightTheme;
}

function App() {
  const {
    selectedDate,
    view,
    tasks,
    mondayFirst,
    themeMode,
    preferredLightTheme,
    preferredDarkTheme,
    useOledForDarkMode,
    uiScale,
    fontScale,
    archiveEnabled,
    visibility,
    setSelectedDate,
    setView,
    setTasks,
    setArchivedTasks,
    setColorSets,
  } = useStore();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [archiveCount, setArchiveCount] = useState(0);
  // Флаг «архив уже выполнен за маунт»: в dev React.StrictMode монтирует
  // компонент дважды и эффект вызывается два раза — второй вызов архивирует
  // 0 задач и затирает счётчик из первого (баннер не появляется).
  const archiveRan = useRef(false);
  // Поиск: полоса поиска открыта, текст, фильтр по цвету-сету,
  // период, статус и сортировка результатов.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchColor, setSearchColor] = useState<string | null>(null);
  const [searchPeriod, setSearchPeriod] = useState<PeriodFilter>("all");
  const [searchStatus, setSearchStatus] = useState<StatusFilter>("all");
  const [searchSort, setSearchSort] = useState<SortKey>("dateAsc");
  // Период «Произвольный»: диапазон с/по (epoch-day; null = край не задан).
  const [searchPeriodFrom, setSearchPeriodFrom] = useState<number | null>(null);
  const [searchPeriodTo, setSearchPeriodTo] = useState<number | null>(null);

  // Тема: применяем разрешённый id, при system — следим за ОС.
  useEffect(() => {
    const apply = () => applyTheme(resolveActiveTheme());
    apply();
    if (themeMode !== "system") return;
    return watchSystemTheme(apply);
  }, [themeMode, preferredLightTheme, preferredDarkTheme, useOledForDarkMode]);

  // Масштаб интерфейса через document.zoom (масштабирует ВЕСЬ интерфейс).
  useEffect(() => {
    (document.documentElement.style as unknown as { zoom: string }).zoom =
      String(uiScale);
  }, [uiScale]);

  // Размер шрифта: множитель на базовый font-size <html>, от которого зависят
  // все --fs-* токены Universal UI. Не трогает zoom, только текст.
  useEffect(() => {
    document.documentElement.style.fontSize = `calc(clamp(13px, 1.05vw, 17px) * ${fontScale})`;
  }, [fontScale]);

  // Авто-архив просроченных невыполненных задач (если включён в настройках).
  // Выполняется один раз за маунт — см. archiveRan выше.
  useEffect(() => {
    if (!archiveEnabled || archiveRan.current) return;
    archiveRan.current = true;
    (async () => {
      try {
        setArchiveCount(await api.archiveOverdue(new Date()));
      } catch {
        /* некритично */
      }
    })();
  }, [archiveEnabled]);

  // Если кнопка поиска скрыта настройками — закрываем открытый поиск
  // и сбрасываем всё его состояние (запрос, фильтры, сортировку).
  useEffect(() => {
    if (!visibility.search) {
      setSearchOpen(false);
      setSearchQuery("");
      setSearchColor(null);
      setSearchPeriod("all");
      setSearchStatus("all");
      setSearchSort("dateAsc");
      setSearchPeriodFrom(null);
      setSearchPeriodTo(null);
    }
  }, [visibility.search]);

  // Загрузка задач. Грузим ВСЕ задачи одним запросом (широкий диапазон дат):
  // правый мини-календарь можно листать на любой месяц, поэтому ограничивать
  // выборку видимым окном нельзя — иначе на будущих неделях не будет задач.
  const reload = useCallback(async () => {
    // Обычные задачи (широкий диапазон для календаря) + «Когда-нибудь» +
    // «Архив» (отдельным пулом — в виды не попадает).
    const [regular, someday, archived] = await Promise.all([
      api.getTasks(new Date(0), new Date(9999, 0, 1)),
      api.getSomedayTasks(),
      api.getArchivedTasks(),
    ]);
    setTasks([...regular, ...someday]);
    setArchivedTasks(archived);
  }, [setTasks, setArchivedTasks]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Загрузка категорий (цвет-сетов) — при старте и после правок в настройках.
  const reloadSets = useCallback(async () => {
    setColorSets(await api.getColorSets());
  }, [setColorSets]);

  useEffect(() => {
    reloadSets();
  }, [reloadSets]);

  const shift = (dir: number) => {
    if (view === "day") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + dir);
      setSelectedDate(d);
    } else if (view === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 7 * dir);
      setSelectedDate(d);
    } else {
      setSelectedDate(
        new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth() + dir,
          selectedDate.getDate(),
        ),
      );
    }
  };

  return (
    <div
      style={{
        background: COLORS.paper,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        color: COLORS.text,
        fontFamily: "var(--font-ui)",
      }}
    >
      <TopBar
        selectedDate={selectedDate}
        view={view}
        mondayFirst={mondayFirst}
        onViewChanged={setView}
        onPrev={() => shift(-1)}
        onNext={() => shift(1)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDatePicker={() => setDatePickerOpen(true)}
        searchActive={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((v) => !v);
          setSearchQuery("");
          setSearchColor(null);
          setSearchPeriod("all");
          setSearchStatus("all");
          setSearchSort("dateAsc");
          setSearchPeriodFrom(null);
          setSearchPeriodTo(null);
        }}
        visibility={visibility}
      />
      {searchOpen && (
        <SearchBar
          query={searchQuery}
          onQuery={setSearchQuery}
          color={searchColor}
          onColor={setSearchColor}
          period={searchPeriod}
          status={searchStatus}
          sort={searchSort}
          onPeriod={setSearchPeriod}
          onStatus={setSearchStatus}
          onSort={setSearchSort}
          from={searchPeriodFrom}
          to={searchPeriodTo}
          onFrom={setSearchPeriodFrom}
          onTo={setSearchPeriodTo}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
            setSearchColor(null);
            setSearchPeriod("all");
            setSearchStatus("all");
            setSearchSort("dateAsc");
            setSearchPeriodFrom(null);
            setSearchPeriodTo(null);
          }}
        />
      )}
      {/* Баннер архива скрывается настройками видимости. */}
      {visibility.archiveBanner && archiveCount > 0 && (
        <div
          style={{
            background: accentTint(0.15),
            color: COLORS.text,
            fontSize: "var(--fs-2xs)",
            padding: "var(--sp-2) var(--sp-8)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
          }}
        >
          <span>
            Архивировано просроченных задач: {archiveCount}
          </span>
          <button
            className="icon-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => setArchiveCount(0)}
            title="Скрыть"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Активный поиск заменяет вид списком результатов по всем задачам. */}
          {searchOpen &&
          (searchQuery.trim() !== "" ||
            searchColor !== null ||
            searchPeriod !== "all" ||
            searchStatus !== "all" ||
            searchSort !== "dateAsc") ? (
            <SearchResults
              tasks={tasks}
              query={searchQuery}
              color={searchColor}
              period={searchPeriod}
              status={searchStatus}
              sort={searchSort}
              from={searchPeriodFrom}
              to={searchPeriodTo}
              onJumpToDay={(d) => {
                setSelectedDate(d);
                setView("day");
              }}
              onChange={reload}
              onResetFilters={() => {
                // Сброс всех фильтров; поиск остаётся открытым.
                setSearchQuery("");
                setSearchColor(null);
                setSearchPeriod("all");
                setSearchStatus("all");
                setSearchSort("dateAsc");
                setSearchPeriodFrom(null);
                setSearchPeriodTo(null);
              }}
            />
          ) : (
            <>
          {view === "day" && (
            <DayView day={selectedDate} tasks={tasks} onChange={reload} />
          )}
          {view === "week" && <WeekView tasks={tasks} onChange={reload} />}
          {view === "month" && (
            <MonthView
              tasks={tasks}
              onChange={reload}
              onSelectDay={(d) => {
                setSelectedDate(d);
                setView("day");
              }}
            />
          )}
            </>
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} onSetsChanged={reloadSets} onTasksChanged={reload} />
      )}
      {datePickerOpen && (
        <DatePickerModal
          tasks={tasks}
          onPick={setSelectedDate}
          onClose={() => setDatePickerOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
