import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";
import { weekDays, firstOfMonth, lastOfMonth } from "./date";
import { COLORS } from "./theme";
import { TopBar } from "./components/TopBar";
import { MiniCalendar } from "./components/MiniCalendar";
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
    setSelectedDate,
    setView,
    setTasks,
    toggleMondayFirst,
  } = useStore();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [isWide, setIsWide] = useState(true);

  // Адаптивность по ширине окна.
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 720);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {isWide && view !== "month" && (
          <div
            style={{
              width: 220,
              padding: 8,
              flexShrink: 0,
              overflowY: "auto",
            }}
          >
            <MiniCalendar tasks={tasks} />
          </div>
        )}
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
          onToggleMondayFirst={toggleMondayFirst}
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
