import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri } from "./api";
import type { Task } from "./api";
import { useStore } from "./store";
import { useShallow } from "zustand/react/shallow";
import { resolveActiveTheme } from "./store";
import type { ViewKind } from "./store";
import { COLORS, applyTheme, watchSystemTheme, accentTint, applyCustomSlot } from "./theme";
import { useMediaQuery } from "./useMediaQuery";
import { TopBar } from "./components/TopBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { DatePickerModal } from "./components/DatePickerModal";
import { AddTaskModal } from "./components/AddTaskModal";
import { fromEpochDay } from "./date";
import { SearchBar } from "./components/SearchBar";
import { Icon } from "./components/Icon";
import type { PeriodFilter, StatusFilter, SortKey } from "./views/SearchResults";
// Тяжёлые не-дефолтные виды грузим лениво: на холодном старте не парсим
// Месяц/Поиск (меньше JS → быстрее первый запуск). Чанки подтягиваются при
// первом переключении на вид (Suspense ниже). День и Неделю держим eager —
// дефолт в сторе — "week", ленивый стартовый вид дал бы вспышку «Загрузка».
const SearchResults = lazy(() =>
  import("./views/SearchResults").then((m) => ({ default: m.SearchResults })),
);
const MonthView = lazy(() =>
  import("./views/MonthView").then((m) => ({ default: m.MonthView })),
);
import { DayView } from "./views/DayView";
import { WeekView } from "./views/WeekView";
import { RightPanel } from "./components/RightPanel";
import { TaskDndContext } from "./drag";
import { setToastListener } from "./toast";
import { scheduleAutoExport, startAutoSync } from "./autoSync";
import "./App.css";

/** Ширина правой панели (общая для «Недели» и «Дня»): resize-ручка в неделе,
 *  мин/макс/ключ/дефолт. Ключ сменили — новая единая ширина 320 применяется
 *  и в дне, и в неделе (старое значение 280/300 не переживает). */
const CAL_MIN = 200;
const CAL_MAX = 520;
const CAL_KEY = "panel.calWidth";
const CAL_DEFAULT = 320;

function loadCalWidth(): number {
  const v = Number(localStorage.getItem(CAL_KEY));
  if (Number.isFinite(v) && v >= CAL_MIN && v <= CAL_MAX) return v;
  return CAL_DEFAULT;
}

/** Эффективная тема: тёмная (dark/oled) или светлая — для виджета. */
function isDarkTheme(): boolean {
  const t = resolveActiveTheme(useStore.getState());
  return t.startsWith("dark") || t.startsWith("oled");
}

// Дебаунс записи данных виджетов. Каждое изменение задачи вызывает reload(),
// а refresh_widget на бэке делает ~24 запроса к SQLite + 2 записи файла
// (widget.json + копия в App Group на macOS). На серии быстрых правок
// (несколько чекбоксов подряд, ввод текста, перенос drag'ом) это лишняя
// нагрузка на CPU/диск и батарею. Коаллесим всплеск в один вызов через 600 мс —
// виджет всё равно обновляется незаметно для пользователя, а фоновый тик
// планировщика (60 с) и перезапись при смене дня остаются страховкой на случай
// пропущенного вызова (например, закрыли приложение в окне дебаунса — тогда
// виджет обновится при следующем старте, когда reload() пишет данные).
let widgetWriteTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWidgetDark = false;
const scheduleWidgetWrite = (dark: boolean) => {
  pendingWidgetDark = dark;
  clearTimeout(widgetWriteTimer);
  widgetWriteTimer = setTimeout(() => {
    widgetWriteTimer = undefined;
    if (!isTauri()) return;
    import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("write_widget_data", { dark: pendingWidgetDark }),
      )
      .catch(() => {});
  }, 600);
};

function App() {
  // useShallow: подписка только на перечисленные поля (а не на весь стор) —
  // иначе любой bump (subtaskRev, autoSyncLastAt) перерисовывал бы всё дерево.
  const {
    selectedDate,
    weekDate,
    monthDate,
    view,
    tasks,
    archivedTasks,
    mondayFirst,
    themeMode,
    preferredLightTheme,
    preferredDarkTheme,
    useOledForDarkMode,
    customLight,
    customDark,
    uiScale,
    fontScale,
    archiveEnabled,
    visibility,
    weekVertical,
    setWeekVertical,
    setSelectedDate,
    setWeekDate,
    setMonthDate,
    setView,
    setTasks,
    setArchivedTasks,
    setColorSets,
    setPreventOverlaps,
    focusTaskId,
    setFocusTask,
  } = useStore(
    useShallow((s) => ({
      selectedDate: s.selectedDate,
      weekDate: s.weekDate,
      monthDate: s.monthDate,
      view: s.view,
      tasks: s.tasks,
      archivedTasks: s.archivedTasks,
      mondayFirst: s.mondayFirst,
      themeMode: s.themeMode,
      preferredLightTheme: s.preferredLightTheme,
      preferredDarkTheme: s.preferredDarkTheme,
      useOledForDarkMode: s.useOledForDarkMode,
      customLight: s.customLight,
      customDark: s.customDark,
      uiScale: s.uiScale,
      fontScale: s.fontScale,
      archiveEnabled: s.archiveEnabled,
      visibility: s.visibility,
      weekVertical: s.weekVertical,
      setWeekVertical: s.setWeekVertical,
      setSelectedDate: s.setSelectedDate,
      setWeekDate: s.setWeekDate,
      setMonthDate: s.setMonthDate,
      setView: s.setView,
      setTasks: s.setTasks,
      setArchivedTasks: s.setArchivedTasks,
      setColorSets: s.setColorSets,
      setPreventOverlaps: s.setPreventOverlaps,
      focusTaskId: s.focusTaskId,
      setFocusTask: s.setFocusTask,
    })),
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Настройка «запрещать наложения» хранится в БД (сервер проверяет при каждом
  // сохранении) — фронт подхватывает её при старте для переключателя.
  useEffect(() => {
    if (!isTauri()) return;
    api
      .getSetting("prevent_overlaps")
      .then((v) => setPreventOverlaps(v !== "0")) // дефолт — запрещать
      .catch(() => {});
  }, [setPreventOverlaps]);
  const [calWidth, setCalWidth] = useState<number>(loadCalWidth);
  useEffect(() => {
    localStorage.setItem(CAL_KEY, String(calWidth));
  }, [calWidth]);
  // Узкое окно недели (порог 820px — тот же, что в WeekView): в нём сетка из
  // 7 колонок нечитаема, список принудителен, поэтому toggle ориентации в
  // шапке не показываем. Общие listener'ы на запросы — см. useMediaQuery.
  const weekNarrow = useMediaQuery("(max-width: 820px)");
  // Панель скрывается в узком окне; порог зависит от вида (неделя 1000,
  // день 700). Раньше у недели был порог 1200 — при дефолтном окне 1100
  // панель в неделе пропадала; 1000 — панель видна, а при 1140+ вместе
  // с сеткой недели.
  const calNarrow = useMediaQuery(`(max-width: ${view === "day" ? 700 : 1000}px)`);
  const [archiveCount, setArchiveCount] = useState(0);
  // Флаг «архив уже выполнен за маунт»: в dev React.StrictMode монтирует
  // компонент дважды и эффект вызывается два раза — второй вызов архивирует
  // 0 задач и затирает счётчик из первого (баннер не появляется).
  const archiveRan = useRef(false);
  // Поиск: полоса поиска открыта, текст, фильтр по цвету-сету,
  // период, статус и сортировка результатов.
  const [searchOpen, setSearchOpen] = useState(false);
  // Ошибка загрузки данных (сбой БД) — показывается баннером, чтобы приложение
  // не выглядело «пустым» без объяснения.
  const [loadError, setLoadError] = useState("");
  // Тост: короткое сообщение об ошибке сохранения и т.п. Автоскрытие — 4.5 с.
  const [toast, setToast] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    setToastListener((msg) => {
      setToast(msg);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(""), 4500);
    });
    return () => {
      clearTimeout(timer);
      setToastListener(null);
    };
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchColor, setSearchColor] = useState<string | null>(null);
  const [searchPeriod, setSearchPeriod] = useState<PeriodFilter>("all");
  const [searchStatus, setSearchStatus] = useState<StatusFilter>("all");
  const [searchSort, setSearchSort] = useState<SortKey>("dateAsc");
  // Период «Произвольный»: диапазон с/по (epoch-day; null = край не задан).
  const [searchPeriodFrom, setSearchPeriodFrom] = useState<number | null>(null);
  const [searchPeriodTo, setSearchPeriodTo] = useState<number | null>(null);
  // Системная кнопка «назад» (Android): закрывает открытую модалку (настройки,
  // календарь, поиск), а если всё закрыто — закрывает окно (выход). Подписка
  // постоянная: обработчик сам решает, что делать (без гонки с unregister).
  const overlaysRef = useRef({ settingsOpen, datePickerOpen, searchOpen });
  overlaysRef.current = { settingsOpen, datePickerOpen, searchOpen };
  useEffect(() => {
    let unregister: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/app")
      .then(({ onBackButtonPress }) =>
        onBackButtonPress(() => {
          const o = overlaysRef.current;
          if (o.settingsOpen) setSettingsOpen(false);
          else if (o.datePickerOpen) setDatePickerOpen(false);
          else if (o.searchOpen) setSearchOpen(false);
          else {
            // Всё закрыто — свернуть в фон, не убивая процесс: следующий
            // запуск из лончера тёплый, без холодного экрана. Полный выход —
            // только «Выйти» в настройках.
            import("@tauri-apps/api/core")
              .then(({ invoke }) => invoke("minimize_app"))
              .catch(() => {});
          }
        }),
      )
      .then((listener) => {
        if (cancelled) listener.unregister();
        else unregister = listener.unregister;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unregister?.();
    };
  }, []);
  // Поиск «активен», когда задан хоть один фильтр: тогда результаты
  // заменяют основной вид, а правая панель остаётся видимой рядом.
  const searchActive =
    searchOpen &&
    (searchQuery.trim() !== "" ||
      searchColor !== null ||
      searchPeriod !== "all" ||
      searchStatus !== "all" ||
      searchSort !== "dateAsc");

  /** Сбросить все фильтры поиска (запрос, цвет, период, статус, сортировку).
   *  Сам поиск при этом остаётся открытым (закрытие — отдельным setSearchOpen). */
  const resetSearch = () => {
    setSearchQuery("");
    setSearchColor(null);
    setSearchPeriod("all");
    setSearchStatus("all");
    setSearchSort("dateAsc");
    setSearchPeriodFrom(null);
    setSearchPeriodTo(null);
  };

  // Тема: применяем разрешённый id, при system — следим за ОС. При смене
  // темы сразу обновляем виджет (dark-флаг) — иначе виджет оставался бы
  // в старой теме до следующего изменения задач.
  useEffect(() => {
    const apply = () => {
      applyTheme(resolveActiveTheme(useStore.getState()));
      // Ранний фон из инлайн-скрипта index.html больше не нужен: тему теперь
      // задаёт data-theme (и кастомный слот — инлайн-переменными). Снимаем
      // инлайн background-color, иначе он перебивал бы тему при переключении.
      // colorScheme оставляем актуальным по эффективной теме.
      const root = document.documentElement;
      root.style.removeProperty("background-color");
      document.body.style.removeProperty("background-color");
      root.style.colorScheme = isDarkTheme() ? "dark" : "light";
      if (isTauri()) {
        scheduleWidgetWrite(isDarkTheme());
      }
    };
    apply();
    if (themeMode !== "system") return;
    return watchSystemTheme(apply);
  }, [themeMode, preferredLightTheme, preferredDarkTheme, useOledForDarkMode]);

  // Слот «Свой выбор»: акцент/фон поверх темы. Слот активен по текущему
  // режиму (тёмный/светлый); в system — по предпочтению ОС.
  useEffect(() => {
    const isDark =
      themeMode === "dark" ||
      (themeMode === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    applyCustomSlot(document.documentElement, isDark ? customDark : customLight, isDark);
  }, [themeMode, customLight, customDark, useOledForDarkMode]);

  // Масштаб интерфейса: увеличиваем сами размеры (переменная --ui-scale,
  // на неё завязаны отступы/кнопки/иконки; шрифт — множителем к базовому
  // font-size). Никаких zoom/transform — layout честно пересчитывается:
  // ничего не обрезается, скролл/клики/ввод работают на любом масштабе.
  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    document.documentElement.style.fontSize = `calc(clamp(13px, 1.05vw, 17px) * ${fontScale} * ${uiScale})`;
  }, [uiScale, fontScale]);

  // Размер шрифта: множитель на базовый font-size <html>, от которого зависят
  // все --fs-* токены Universal UI. Не трогает zoom, только текст. (Множитель
  // uiScale уже учтён выше — этот эффект убран в пользу единой формулы.)

  // Настройки уведомлений → Rust-планировщик (при старте и при изменении).
  const { notifyDaySummary, notifyDayHour, notifyReminders, notifyRemindMinutes } =
    useStore(
      useShallow((s) => ({
        notifyDaySummary: s.notifyDaySummary,
        notifyDayHour: s.notifyDayHour,
        notifyReminders: s.notifyReminders,
        notifyRemindMinutes: s.notifyRemindMinutes,
      })),
    );
  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("set_notification_prefs", {
          prefs: {
            daySummary: notifyDaySummary,
            daySummaryHour: notifyDayHour,
            reminders: notifyReminders,
            remindMinutes: notifyRemindMinutes,
          },
        }),
      )
      .catch(() => {});
  }, [notifyDaySummary, notifyDayHour, notifyReminders, notifyRemindMinutes]);

  // Разрешение на уведомления (Android 13+) — запрашиваем один раз при
  // старте, если уведомления включены (Rust-планировщик не может запросить
  // сам: вызов из setup блокирует приложение).
  useEffect(() => {
    if (!isTauri() || (!notifyDaySummary && !notifyReminders)) return;
    import("@tauri-apps/plugin-notification")
      .then(({ isPermissionGranted, requestPermission }) =>
        isPermissionGranted().then((granted) => {
          if (!granted) requestPermission();
        }),
      )
      .catch(() => {});
  }, [notifyDaySummary, notifyReminders]);

  // Авто-архив просроченных невыполненных задач (если включён в настройках).
  // Выполняется один раз за маунт — см. archiveRan выше.
  useEffect(() => {
    if (!archiveEnabled || archiveRan.current) return;
    archiveRan.current = true;
    (async () => {
      try {
        setArchiveCount(await api.archiveOverdue());
        // Заархивированные задачи должны исчезнуть из видов, а «Архив» —
        // получить их: перезагружаем оба пула (мутация → и автоэкспорт).
        onMutation();
      } catch {
        /* некритично */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveEnabled]);

  // Если кнопка поиска скрыта настройками — закрываем открытый поиск
  // и сбрасываем всё его состояние (запрос, фильтры, сортировку).
  useEffect(() => {
    if (!visibility.search) {
      setSearchOpen(false);
      resetSearch();
    }
  }, [visibility.search]);

  // Загрузка задач. Грузим ВСЕ задачи одним запросом (широкий диапазон дат):
  // правый мини-календарь можно листать на любой месяц, поэтому ограничивать
  // выборку видимым окном нельзя — иначе на будущих неделях не будет задач.
  // seq-счётчик защищает от гонки: быстрые изменения задач запускают несколько
  // reload'ов, и устаревший ответ не должен перетирать свежие данные.
  const reloadSeq = useRef(0);
  const milestoneSent = useRef(false);
  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current;
    // Обычные задачи (широкий диапазон для календаря) + «Когда-нибудь» +
    // «Архив» (отдельным пулом — в виды не попадает).
    try {
      const [regular, someday, archived] = await Promise.all([
        api.getTasks(new Date(0), new Date(9999, 0, 1)),
        api.getSomedayTasks(),
        api.getArchivedTasks(),
      ]);
      if (seq !== reloadSeq.current) return; // ответ устарел — пропускаем
      setTasks([...regular, ...someday]);
      setArchivedTasks(archived);
      // Метка холодного старта: данные отрисованы (в журнал диагностики
      // пишется один раз за процесс — «не запустилось с первого раза»
      // различает «процесс не стартовал» и «стартовал, но завис до данных»).
      if (!milestoneSent.current && isTauri()) {
        milestoneSent.current = true;
        import("@tauri-apps/api/core")
          .then(({ invoke }) =>
            invoke("startup_milestone", { name: "tasks-loaded" }).catch(() => {}),
          )
          .catch(() => {});
      }
    } catch (e) {
      // Сбой БД/загрузки — не оставляем пользователя с «пустым» приложением
      // без объяснения: показываем заглушку-предупреждение.
      console.error("Не удалось загрузить задачи:", e);
      setLoadError("Не удалось загрузить задачи. Проверьте доступ к данным приложения.");
      return;
    }
    // Данные для виджетов (Android + macOS) — пишем при перезагрузке задач
    // через дебаунс: всплеск правок коаллесится в один вызов (см.
    // scheduleWidgetWrite), экономя CPU/диск/батарею. Тему передаём явно:
    // виджет должен выглядеть как приложение, а не по системной теме устройства.
    if (isTauri()) scheduleWidgetWrite(isDarkTheme());
  }, [setTasks, setArchivedTasks]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Мутация данных: перезагрузка + отложенный автоэкспорт. Экспорт — ТОЛЬКО
  // отсюда, не из reload(): после успешного автоимпорта App тоже зовёт reload,
  // и экспорт внутри reload устраивал бы пинг-понг бэкапов между устройствами
  // (каждый импорт порождал бы новый экспорт, и так по кругу).
  const onMutation = useCallback(() => {
    void reload();
    if (isTauri()) scheduleAutoExport();
  }, [reload]);

  // Автоимпорт из заданной папки: при старте и раз в минуту проверяем, не
  // появился ли более свежий файл синхронизации (писал другой экземпляр
  // приложения). Импорт — полная замена; после него перезагружаем данные.
  useEffect(() => {
    if (!isTauri()) return;
    const stop = startAutoSync(() => void reload());
    return stop;
  }, [reload]);

  // Загрузка категорий (цвет-сетов) — при старте и после правок в настройках.
  const reloadSets = useCallback(async () => {
    try {
      setColorSets(await api.getColorSets());
    } catch (e) {
      console.error("Не удалось загрузить категории:", e);
    }
  }, [setColorSets]);

  useEffect(() => {
    reloadSets();
  }, [reloadSets]);

  // Активная дата вида: у каждого вида свой якорь (weekDate/monthDate),
  // чтобы выбор дня в «Дне» не двигал неделю/месяц; null = вид ещё не
  // открывался — используем выбранный день.
  const topDate =
    view === "week"
      ? (weekDate ?? selectedDate)
      : view === "month"
        ? (monthDate ?? selectedDate)
        : selectedDate;

  // Выбор даты (мини-календарь, кнопка «Дата») в контексте текущего вида:
  // в «Дне» меняется только выбранный день, в «Неделе»/«Месяце» — ещё и якорь.
  const pickDate = (d: Date) => {
    if (view === "week") {
      setWeekDate(d);
      setSelectedDate(d);
    } else if (view === "month") {
      setMonthDate(d);
      setSelectedDate(d);
    } else {
      setSelectedDate(d);
    }
  };

  const shift = (dir: number) => {
    if (view === "day") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + dir);
      setSelectedDate(d);
    } else if (view === "week") {
      const base = weekDate ?? selectedDate;
      const d = new Date(base);
      d.setDate(d.getDate() + 7 * dir);
      setWeekDate(d);
      setSelectedDate(d);
    } else {
      const base = monthDate ?? selectedDate;
      const targetMonth = base.getMonth() + dir;
      const targetYear = base.getFullYear();
      const lastDayOfTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
      const clampedDay = Math.min(base.getDate(), lastDayOfTarget);
      const d = new Date(targetYear, targetMonth, clampedDay);
      setMonthDate(d);
      setSelectedDate(d);
    }
  };

  // Свайпы для переключения вида (День/Неделя/Месяц): свайп влево = следующий
  // режим, вправо = предыдущий, циклически. Работают по ВСЕМУ полю, включая
  // карточки задач. Игнорируем только: сфокусированное поле ввода (идёт набор
  // текста), ручку перетаскивания задачи (@dnd-kit), колёсики времени и кнопки
  // верхней панели (иначе свайп по ⚙ переключал бы вид вместо настроек).
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const ORDER: ViewKind[] = ["day", "week", "month"];
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Порог: 60px по горизонтали, вертикаль не больше 40px (иначе это скролл).
    if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
    const el = e.target as HTMLElement;
    // Не мешаем вводу текста: свайп по инпуту/тексту задачи с активным
    // фокусом не переключает вид (палец на клавиатуре двигает поле).
    const ae = document.activeElement;
    const typing =
      ae instanceof HTMLElement &&
      (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT") &&
      (ae === el || el.contains(ae));
    if (typing) return;
    // Ручка перетаскивания, колёсики времени, кнопки шапки — их свайп не
    // трогает (ручка — drag, кнопки — тап, колёсики — свой скролл). Также
    // исключаем окно настроек и ВСЕ модальные оверлеи (карточка задачи,
    // календарь дат, модалка месяца, подтверждения): листание их контента
    // не должно переключать вид за оверлеем.
    if (el.closest(".task-drag-hint, .time-wheel, .icon-btn, .settings-overlay, .modal-overlay")) return;
    const idx = ORDER.indexOf(view);
    if (dx < 0) setView(ORDER[(idx + 1) % ORDER.length]); // влево — следующий
    else setView(ORDER[(idx - 1 + ORDER.length) % ORDER.length]); // вправо — предыдущий
  };

  // Задача из глубокой ссылки (тап по уведомлению): карточка открывается,
  // когда задача появилась в tasks (cold-start → reload ещё не отдал список,
  // поэтому ждём, пока не найдём её по id).
  const focusTask = focusTaskId ? (tasks.find((t) => t.id === focusTaskId) ?? null) : null;

  return (
    // <main>-landmark для скринридеров и навигации (Lighthouse a11y).
    <main style={{ height: "100%" }}>
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        background: COLORS.paper,
        // height:100% вместо 100vh: vh не масштабируется CSS zoom (uiScale>1),
        // контейнер получал двойное масштабирование и вылезал за окно
        // (нижние элементы — архив — становились невидимыми).
        height: "100%",
        display: "flex",
        flexDirection: "column",
        color: COLORS.text,
        fontFamily: "var(--font-ui)",
      }}
    >
      <TopBar
        selectedDate={topDate}
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
          resetSearch();
        }}
        visibility={visibility}
        showWeekToggle={view === "week" && !weekNarrow}
        weekVertical={weekVertical}
        onToggleWeekOrientation={() => setWeekVertical(!weekVertical)}
      />
      {/* Баннер ошибки загрузки данных — не «пустой» экран без объяснения. */}
      {loadError && (
        <div
          style={{
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            color: COLORS.text,
            fontSize: "var(--fs-2xs)",
            padding: "var(--sp-2) var(--sp-8)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
          }}
        >
          <span>{loadError}</span>
          <button
            className="icon-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => setLoadError("")}
            title="Скрыть"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {/* Тост (ошибка сохранения и т.п.) — поверх контента, автоскрытие. */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "calc(var(--control-h) + var(--sp-3))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "color-mix(in srgb, var(--danger) 14%, var(--bg-secondary))",
            color: COLORS.text,
            fontSize: "var(--fs-sm)",
            padding: "var(--sp-2) var(--sp-4)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            maxWidth: "min(90vw, 420px)",
          }}
        >
          {toast}
        </div>
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
            Перенесено в архив просроченных задач: {archiveCount} — можно
            восстановить из раздела «Архив»
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
      {/* Один общий drag-контекст на контент и панель: переносы между
          «Когда-нибудь» и днями работают во всех видах и в поиске. */}
      <TaskDndContext onChange={onMutation}>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Левая колонка: строка поиска над контентом — правая панель
              не сдвигается вниз при открытии поиска. minHeight 0 обязателен:
              иначе flex-колонка растёт по контенту (день с задачами) и
              внутренний скролл не появляется — контент обрезается. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                  resetSearch();
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* Активный поиск заменяет вид списком результатов по всем задачам. */}
              <Suspense
                fallback={
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: COLORS.muted,
                      fontSize: "var(--fs-sm)",
                    }}
                  >
                    Загрузка…
                  </div>
                }
              >
              {searchActive ? (
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
                    // Сброс фильтров + закрытие поиска: иначе searchActive
                    // остался бы true и SearchResults заменил бы собой день.
                    resetSearch();
                    setSearchOpen(false);
                  }}
                  onChange={onMutation}
                  onResetFilters={() => {
                    // Сброс всех фильтров; поиск остаётся открытым.
                    resetSearch();
                  }}
                />
              ) : (
                <>
                  {view === "day" && (
                    <DayView
                      day={selectedDate}
                      tasks={tasks}
                      archivedTasks={archivedTasks}
                      onChange={onMutation}
                    />
                  )}
                  {view === "week" && (
                    <WeekView
                      tasks={tasks}
                      archivedTasks={archivedTasks}
                      onChange={onMutation}
                    />
                  )}
                  {view === "month" && (
                    <MonthView
                      tasks={tasks}
                      onChange={onMutation}
                      onSelectDay={(d) => {
                        setSelectedDate(d);
                        setView("day");
                      }}
                      onSelectWeek={(d) => {
                        setWeekDate(d);
                        setSelectedDate(d);
                        setView("week");
                      }}
                    />
                  )}
                </>
              )}
              </Suspense>
            </div>
          </div>
          {/* Правая панель — одна на все виды (в месяце без мини-календаря,
              но с «Когда-нибудь» и «Архивом»). Скрытие кнопкой убрано по
              желанию пользователя — только адаптив (calNarrow) и настройки
              видимости секций. Панель показываем, если видна хоть одна
              секция ИЛИ в архиве есть задачи (архив нельзя потерять). */}
          {!calNarrow && (visibility.miniCalendar || visibility.someday || archivedTasks.length > 0) && (
            <AppRightPanel
              view={view}
              tasks={tasks}
              calWidth={calWidth}
              onResize={setCalWidth}
              onSelect={pickDate}
              onChange={onMutation}
            />
          )}
        </div>
      </TaskDndContext>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSetsChanged={reloadSets}
          onTasksChanged={reload}
          onResetUI={() => setCalWidth(CAL_DEFAULT)}
        />
      )}
      {datePickerOpen && (
        <DatePickerModal
          tasks={tasks}
          onPick={pickDate}
          onClose={() => setDatePickerOpen(false)}
        />
      )}
      {/* Карточка задачи из уведомления (deep-link). Открывается, как только
          задача подгрузилась; после сохранения/закрытия фокус сбрасывается. */}
      {focusTask && (
        <AddTaskModal
          day={fromEpochDay(focusTask.date)}
          initial={focusTask}
          onChange={onMutation}
          onClose={() => {
            setFocusTask(null);
            reload();
          }}
        />
      )}
    </div>
    </main>
  );
}

/** Правая панель на уровне App: в «Неделе» — с resize-handle и шириной из
 *  localStorage, в «Дне» — той же шириной без ручки (значение общее, панель
 *  не «гуляет» между видами). Поиск её не трогает. */
function AppRightPanel({
  view,
  tasks,
  calWidth,
  onResize,
  onSelect,
  onChange,
}: {
  view: ViewKind;
  tasks: Task[];
  calWidth: number;
  onResize: (w: number) => void;
  onSelect: (d: Date) => void;
  onChange: () => void;
}) {
  const draggingRef = useRef(false);

  // Resize мышью через drag-handle на левом краю панели.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = calWidth;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      // Движение мыши влево увеличивает ширину (handle слева от панели).
      // Панель не должна съедать контент: минимум 240px под левую колонку.
      const maxW = Math.max(CAL_MIN, window.innerWidth - 240);
      const next = Math.min(Math.min(CAL_MAX, maxW), Math.max(CAL_MIN, startWidth + (startX - ev.clientX)));
      onResize(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Единая ширина панели в «Дне» и «Неделе» (calWidth): resize-ручка есть
  // только в неделе, но значение общее — панель не «гуляет» между видами.
  // Дополнительно ограничиваем ширину по окну: панель не должна занимать
  // весь экран (под контент — минимум 240px), даже если сохранённая ширина
  // была выставлена на большом мониторе.
  const effectiveWidth = Math.max(CAL_MIN, Math.min(calWidth, window.innerWidth - 240));
  if (view === "day") {
    return <RightPanel tasks={tasks} width={effectiveWidth} onSelect={onSelect} onChange={onChange} />;
  }
  return (
    <div
      style={{
        position: "relative",
        width: effectiveWidth,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Drag-handle для изменения ширины. Сиблинг контента, чтобы его не
          обрезал внутренний скролл. */}
      <div
        onMouseDown={startResize}
        title="Тяните, чтобы изменить ширину"
        style={{
          position: "absolute",
          left: -3,
          top: 0,
          bottom: 0,
          width: 7,
          cursor: "col-resize",
          zIndex: 2,
        }}
      />
      <RightPanel tasks={tasks} onSelect={onSelect} onChange={onChange} fill />
    </div>
  );
}

export default App;
