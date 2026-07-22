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
    setSelectedDate,
    setView,
    setTasks,
  } = useStore();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [rolloverCount, setRolloverCount] = useState(0);

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

  // Авто-перенос невыполненных задач.
  useEffect(() => {
    (async () => {
      try {
        setRolloverCount(await api.rolloverOverdue(new Date()));
      } catch {
        /* некритично */
      }
    })();
  }, []);

  // Загрузка задач.
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
    setTasks(await api.getTasks(start, end));
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
      />
      {rolloverCount > 0 && (
        <div
          style={{
            background: COLORS.accent + "26",
            color: COLORS.text,
            fontSize: "var(--fs-2xs)",
            padding: "var(--sp-2) var(--sp-8)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
          }}
        >
          <span>
            Перенесено невыполненных задач на сегодня: {rolloverCount}
          </span>
          <button
            className="icon-btn"
            style={{ marginLeft: "auto", fontSize: "var(--fs-xs)" }}
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
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
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
