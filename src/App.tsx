import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";
import { weekDays, firstOfMonth, lastOfMonth } from "./date";
import { COLORS, applyTheme, watchSystemTheme } from "./theme";
import { TopBar } from "./components/TopBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { DatePickerModal } from "./components/DatePickerModal";
import { DayView } from "./views/DayView";
import { WeekView } from "./views/WeekView";
import { WeekViewVertical } from "./views/WeekViewVertical";
import { MonthView } from "./views/MonthView";
import "./App.css";

function App() {
  const {
    selectedDate,
    view,
    tasks,
    mondayFirst,
    palette,
    modePref,
    scale,
    setSelectedDate,
    setView,
    setTasks,
    toggleMondayFirst,
    setPalette,
    setModePref,
    setScale,
  } = useStore();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [isWide, setIsWide] = useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 720px)").matches : true,
  );
  const [rolloverCount, setRolloverCount] = useState(0);

  // Применяем тему (палитра + режим). В auto — следим за системой.
  useEffect(() => {
    applyTheme(palette, modePref);
    if (modePref !== "auto") return;
    return watchSystemTheme(() => applyTheme(palette, modePref));
  }, [palette, modePref]);

  // Масштаб интерфейса: класс scale-* на <html>.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("scale-sm", "scale-md", "scale-lg", "scale-xl");
    html.classList.add(`scale-${scale}`);
  }, [scale]);

  // Адаптивность по ширине окна через matchMedia — надёжнее в Tauri WebView,
  // срабатывает сразу при пересечении порога, а не на каждый пиксель ресайза.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 720px)");
    const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener("change", handler);
    setIsWide(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Авто-перенос невыполненных прошлых задач на сегодня (Automate).
  // Запускается один раз при старте приложения.
  useEffect(() => {
    (async () => {
      try {
        const today = new Date();
        const count = await api.rolloverOverdue(today);
        setRolloverCount(count);
      } catch {
        // не критично — просто не показываем плашку
      }
    })();
  }, []);

  // Загрузка задач при смене даты/вида.
  const reload = useCallback(async () => {
    let start: Date;
    let end: Date;
    if (view === "day") {
      start = end = selectedDate;
    } else if (view === "week") {
      const days = weekDays(selectedDate, mondayFirst);
      start = days[0];
      end = days[6];
    } else {
      start = firstOfMonth(selectedDate);
      end = lastOfMonth(selectedDate);
    }
    const loaded = await api.getTasks(start, end);
    setTasks(loaded);
  }, [view, selectedDate, mondayFirst, setTasks]);

  useEffect(() => {
    reload();
  }, [reload]);

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
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
      />
      {rolloverCount > 0 && (
        <div
          style={{
            background: COLORS.accent + "26",
            color: COLORS.text,
            fontSize: 12,
            padding: "6px 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>
            Перенесено невыполненных задач на сегодня: {rolloverCount}
          </span>
          <button
            className="icon-btn"
            style={{ marginLeft: "auto", fontSize: 14 }}
            onClick={() => setRolloverCount(0)}
          >
            ✕
          </button>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {view === "day" && (
            <DayView day={selectedDate} tasks={tasks} onChange={reload} />
          )}
          {view === "week" &&
            (isWide ? (
              <WeekView tasks={tasks} onChange={reload} />
            ) : (
              <WeekViewVertical tasks={tasks} onChange={reload} />
            ))}
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
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          mondayFirst={mondayFirst}
          palette={palette}
          modePref={modePref}
          scale={scale}
          onToggleMondayFirst={toggleMondayFirst}
          onPaletteChange={setPalette}
          onModePrefChange={setModePref}
          onScaleChange={setScale}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {datePickerOpen && (
        <DatePickerModal
          initial={selectedDate}
          onPick={setSelectedDate}
          onClose={() => setDatePickerOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
