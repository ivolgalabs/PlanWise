# Меньше линий, единый радиус, панель не трогает поиск — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) правая панель поднимается на уровень App — поиск не меняет её ширину/видимость/положение (строка поиска живёт над левой колонкой контента, один общий DndContext на всё); (2) сократить линии и рамки (месяц, строки задач, колонки недели, правая панель, чипы поиска, зоны сдвига) по дизайну «среднего» уровня; (3) единый радиус `radius-md` во всех контейнерах.

**Architecture:** App.tsx становится владельцем раскладки «левая колонка (SearchBar + вид/результаты) + правая панель» и единого `TaskDndContext`; WeekView/DayView/MonthView теряют свои обёртки контекста и рендер панели (получают пропсы `showPanel`/`onTogglePanel`). Линии: удаление border-деклараций в компонентах; радиус: замена `radius-lg`/`radius-xl` на `radius-md`.

**Tech Stack:** React 19 + TS, dnd-kit, zustand, universal-ui токены.

## Global Constraints

- Комментарии — на русском, в стиле окружающего кода.
- Проверка каждой задачи: `npx tsc --noEmit` (0 ошибок; проект включает noUnusedLocals — dead-импорты ломают сборку) + браузерная проверка (:1100, фоллбек).
- `npm run build` — в финальной задаче.
- Коммиты — после каждой задачи.
- Не добавлять ничего сверх брифа (YAGNI).

---

### Task 1: Панель на уровень App (архитектурный перенос)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/views/WeekView.tsx`
- Modify: `src/views/DayView.tsx`
- Modify: `src/views/MonthView.tsx`

**Interfaces:**
- Consumes: `RightPanel({ tasks, width?, onSelect, onChange })` (существующий), `TaskDndContext({ children, onChange })` (существующий), `store.visibility`, `store.archivedTasks`.
- Produces: App-level раскладка: `[левая колонка: SearchBar + контент] [AppRightPanel]` внутри одного `TaskDndContext`; `WeekView`/`DayView` получают пропсы `showPanel: boolean; onTogglePanel: () => void`; виды больше не рендерят панель и не оборачивают себя в `TaskDndContext`.

- [ ] **Step 1: App.tsx — состояние и константы**

В начало файла (после импортов) добавить константы ширины панели (перенести из WeekView):

```tsx
const CAL_MIN = 200;
const CAL_MAX = 520;
const CAL_KEY = "week.calWidth";
const CAL_DEFAULT = 300;

function loadCalWidth(): number {
  const v = Number(localStorage.getItem(CAL_KEY));
  if (Number.isFinite(v) && v >= CAL_MIN && v <= CAL_MAX) return v;
  return CAL_DEFAULT;
}
```

В теле `App` после `const [datePickerOpen, setDatePickerOpen] = useState(false);` добавить:

```tsx
  // Правая панель на уровне App: один элемент на все виды и поиск — при
  // открытии поиска панель не меняет ширину/видимость/положение.
  const [showPanel, setShowPanel] = useState(true);
  const [calWidth, setCalWidth] = useState<number>(loadCalWidth);
  useEffect(() => {
    localStorage.setItem(CAL_KEY, String(calWidth));
  }, [calWidth]);
  // Панель скрывается в узком окне; порог зависит от вида (неделя 1200,
  // день 700 — как раньше было в видах).
  const [calNarrow, setCalNarrow] = useState(
    () => window.matchMedia(`(max-width: ${view === "day" ? 700 : 1200}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${view === "day" ? 700 : 1200}px)`);
    const handler = (e: MediaQueryListEvent) => setCalNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [view]);
```

- [ ] **Step 2: App.tsx — раскладка и панель**

Добавить импорты:

```tsx
import { TaskDndContext } from "./drag";
import { RightPanel } from "./components/RightPanel";
```

Заменить блок контента (от `<div style={{ flex: 1, display: "flex", minHeight: 0 }}>` до закрывающего `</div>` перед `{settingsOpen && (`) на:

```tsx
      {/* Один общий drag-контекст на контент и панель: переносы между
          «Когда-нибудь» и днями работают во всех видах и в поиске. */}
      <TaskDndContext onChange={reload}>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Левая колонка: строка поиска над контентом — правая панель
              не сдвигается вниз при открытии поиска. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
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
            <div style={{ flex: 1, minWidth: 0 }}>
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
                    <DayView
                      day={selectedDate}
                      tasks={tasks}
                      onChange={reload}
                      showPanel={showPanel}
                      onTogglePanel={() => setShowPanel((v) => !v)}
                    />
                  )}
                  {view === "week" && (
                    <WeekView
                      tasks={tasks}
                      onChange={reload}
                      showPanel={showPanel}
                      onTogglePanel={() => setShowPanel((v) => !v)}
                    />
                  )}
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
          {/* Правая панель — одна на все виды и поиск (в месяце не показывается). */}
          {view !== "month" && showPanel && !calNarrow && (visibility.miniCalendar || visibility.someday) && (
            <AppRightPanel
              view={view}
              tasks={tasks}
              calWidth={calWidth}
              onResize={setCalWidth}
              onSelect={setSelectedDate}
              onChange={reload}
            />
          )}
        </div>
      </TaskDndContext>
```

Убрать из App старый блок поиска между TopBar и баннером (`{searchOpen && (<SearchBar …/>)}` — перенесён в левую колонку) и старый блок `{searchActive && (<RightPanel width={280} …/>)}` после контента.

В конец файла (после `App` или перед `export default App`) добавить компонент панели (логика resize-ручки переносится из WeekView):

```tsx
/** Правая панель на уровне App: в «Неделе» — с resize-handle и шириной из
 *  localStorage, в «Дне» — фиксированная 280. Поиск её не трогает. */
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
      const next = Math.min(CAL_MAX, Math.max(CAL_MIN, startWidth + (startX - ev.clientX)));
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

  if (view === "day") {
    return <RightPanel tasks={tasks} width={280} onSelect={onSelect} onChange={onChange} />;
  }
  return (
    <div
      style={{
        position: "relative",
        width: calWidth,
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
      <RightPanel tasks={tasks} onSelect={onSelect} onChange={onChange} />
    </div>
  );
}
```

Нужен импорт `Task` из `./api` и `ViewKind` из `./store` (проверить: `ViewKind` уже импортируется? App импортирует `PeriodFilter, StatusFilter, SortKey` — добавить `ViewKind`).

- [ ] **Step 3: WeekView.tsx**

Убрать: `CAL_MIN/CAL_MAX/CAL_KEY/CAL_DEFAULT/loadCalWidth`, состояния `showCalendar`, `calWidth`, `calNarrow` (+его эффект), локальный `showCal`/`showPanel` (заменить пропсом), компонент `RightCalendar` целиком, рендер панели, обёртку `TaskDndContext`.

Импорты: убрать `TaskDndContext`, `RightPanel`; `COLORS` оставить только если ещё используется (проверить — Toolbar не использует COLORS напрямую; если не используется — убрать импорт). Добавить в интерфейс Props:

```tsx
  /** Видимость правой панели (App) — кнопка тулбара переключает её. */
  showPanel: boolean;
  onTogglePanel: () => void;
```

Тулбар: `showCalendar={showPanel}`, `onToggleCalendar={onTogglePanel}`, `calendarVisible={visibility.miniCalendar || visibility.someday}` (уже так).

Корень компонента: вместо `<TaskDndContext onChange={onChange}><div style={{ display: "flex", height: "100%", minHeight: 0 }}>…</div></TaskDndContext>` вернуть только внутренний `<div style={{ display: "flex", height: "100%", minHeight: 0 }}>` (главная область + тулбар, без панели).

- [ ] **Step 4: DayView.tsx**

Убрать: состояния `showPanel`, `calNarrow` (+эффект), константу `panelVisible` и рендер `RightPanel`; обёртку `TaskDndContext`. Импорты: убрать `TaskDndContext`, `RightPanel` (MiniCalendar/SomedayColumn уже не импортируются).

Интерфейс Props — добавить:

```tsx
  /** Видимость правой панели (App) — кнопка в заголовке дня переключает её. */
  showPanel: boolean;
  onTogglePanel: () => void;
```

`panelPossible` оставить (из store: `visibility.miniCalendar || visibility.someday`) — для кнопки в заголовке. `DayTasksArea` получает `showPanel={showPanel}`, `onTogglePanel={onTogglePanel}`, `panelPossible={panelPossible}` (пропсы уже есть в DayTasksArea).

Корень: убрать обёртку `TaskDndContext`, вернуть внутренний `<div style={{ display: "flex", height: "100%", minHeight: 0 }}>` (DayTasksArea + SideDayZone).

- [ ] **Step 5: MonthView.tsx**

Убрать обёртку `TaskDndContext` и импорт `TaskDndContext` из `../drag` (импорт `dayId` остаётся — он используется в MonthCell).

- [ ] **Step 6: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок (при unused-импортах tsc упадёт — удалить их).

- [ ] **Step 7: Браузерная проверка (:1100)**

- Открыть поиск и ввести запрос: правая панель не меняет ширину/положение/видимость; строка поиска — над левой колонкой.
- Скрыть панель кнопкой в неделе → открыть поиск → панель остаётся скрытой; в дне — кнопка в заголовке.
- Drag «Когда-нибудь»⇄день работает (единый контекст); промоут подзадачи в задачу — диалог работает.
- Баннер архива, настройки, месяц — без поломок.

- [ ] **Step 8: Коммит**

```bash
git add src/App.tsx src/views/WeekView.tsx src/views/DayView.tsx src/views/MonthView.tsx
git commit -m "feat: правая панель на уровне App — поиск её не трогает"
```

---

### Task 2: Меньше линий + единый радиус

**Files:**
- Modify: `src/App.css`, `src/components/SearchBar.tsx`, `src/components/RightPanel.tsx`, `src/components/SomedayColumn.tsx`, `src/components/WeekShiftZone.tsx`, `src/components/MiniCalendar.tsx`, `src/components/DayColumn.tsx`, `src/views/WeekViewVertical.tsx`, `src/views/MonthView.tsx`, `src/components/TimePicker.tsx`, `src/drag.tsx`, `src/components/SettingsPanel.css`, `src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: текущие компоненты (без изменения интерфейсов).
- Produces: визуальные правки — меньше рамок/линий, единый `radius-md`.

- [ ] **Step 1: Строки задач — убрать линию**

`src/App.css`: удалить правило `.task-block { border-bottom: 1px solid var(--border-color); }` целиком (строки разделяются воздухом и hover-фоном `.task-line:hover`).

- [ ] **Step 2: Ячейки месяца**

`src/views/MonthView.tsx`, в `MonthCell` style-объекте удалить строку `border: \`${isTd ? 2 : 1}px solid ${isTd ? COLORS.accent : COLORS.cardBorder}\`,` (рамка «сегодня» уже даётся `boxShadow: today ? \`inset 0 0 0 1.5px ${COLORS.accent}\` : "none"`). В модалке «Перейти к дню» заменить `borderRadius: "var(--radius-xl)"` на `"var(--radius-md)"`.

- [ ] **Step 3: Колонки недели**

`src/components/DayColumn.tsx`, в style корневого div заменить:

```tsx
        border: `${today || selected ? 2 : 1}px solid ${
          today || selected ? COLORS.accent : COLORS.cardBorder
        }`,
```

на:

```tsx
        // Рамка только у «сегодня»; остальные колонки — фон без рамки
        // (выбранный день выделяется акцент-фоном выше).
        border: today ? `2px solid ${COLORS.accent}` : "none",
```

В `src/views/WeekViewVertical.tsx`, в `DayRow` заменить `border: \`1px solid ${selected ? COLORS.accent : "transparent"}\`,` на `border: "none",` (выбранный день остаётся выделен фоном `accentTint(0.05)`).

- [ ] **Step 4: Правая панель — лишние линии**

`src/components/RightPanel.tsx`: у полоски «Архив» убрать `borderTop: \`1px solid ${COLORS.cardBorder}\`,` (секция и так прижата к низу, отделена воздухом; заголовок остаётся акцентным текстом).
`src/components/SomedayColumn.tsx`: у инпута «+ когда-нибудь» убрать `borderTop: \`1px solid ${COLORS.cardBorder}\`,` (остаётся одна линия — разделитель «календарь / Когда-нибудь» у секции).

- [ ] **Step 5: Чипы поиска — рамка только у активного**

`src/components/SearchBar.tsx`:
- Чип «Все» и чипы категорий: заменить `border: \`1px solid ${color === null ? COLORS.accent : COLORS.cardBorder}\`,` на `border: \`1px solid ${color === null ? COLORS.accent : "transparent"}\`,` (и аналогично `color === c.id`); фон активного остаётся `accentTint(0.1)`.
- В `FilterSelect` кнопку: `border: \`1px solid ${open ? COLORS.accent : COLORS.cardBorder}\`,` → `border: \`1px solid ${open ? COLORS.accent : "transparent"}\`,`.

- [ ] **Step 6: Зона сдвига недели**

`src/components/WeekShiftZone.tsx`: убрать `border: \`1px dashed ${isOver ? COLORS.accent : COLORS.cardBorder}\`,` (остаётся акцент-фон при isOver и цвет текста).

- [ ] **Step 7: Единый радиус radius-md**

Заменить `var(--radius-lg)` и `var(--radius-xl)` на `var(--radius-md)` во всех вхождениях (проверить grep — сейчас 7 файлов):
- `src/App.css` — `.day-column`, `.color-menu`;
- `src/components/MiniCalendar.tsx` — карточка календаря;
- `src/components/TimePicker.tsx` — выпадающее меню;
- `src/components/SettingsPanel.css` — панель/секции;
- `src/drag.tsx` — DragGhost (px 6 → `var(--radius-md)`);
- `src/views/MonthView.tsx` — модалка (Step 2 уже);
- `src/components/DayColumn.tsx` — если есть.
Не трогать `radius-sm`/`radius-xs` (мелкие элементы).

- [ ] **Step 8: Проверить типы и собрать**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit && npm run build`
Expected: 0 ошибок, build чистый.

- [ ] **Step 9: Браузерная проверка (:1100)**

Месяц: ячейки без рамок, «сегодня» — акцентная обводка; строки задач без линий (hover работает); колонки недели без рамок (кроме «сегодня»); правая панель — одна линия «календарь/Когда-нибудь»; чипы поиска без рамок (активный — с рамкой); радиус единый у карточек/меню; список недели без рамки выбранного дня.

- [ ] **Step 10: Коммит**

```bash
git add src/App.css src/components/SearchBar.tsx src/components/RightPanel.tsx src/components/SomedayColumn.tsx src/components/WeekShiftZone.tsx src/components/MiniCalendar.tsx src/components/DayColumn.tsx src/views/WeekViewVertical.tsx src/views/MonthView.tsx src/components/TimePicker.tsx src/drag.tsx src/components/SettingsPanel.css src/components/SettingsPanel.tsx
git commit -m "style: меньше линий и рамок, единый радиус radius-md"
```

---

### Task 3: Финальная верификация + доки

**Files:** нет кодовых правок.

- [ ] **Step 1: Сборка**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit && npm run build`
Expected: чисто.

- [ ] **Step 2: Сквозная браузерная проверка**

Поиск не трогает панель (ширина/видимость/положение), drag-переносы, месяц/неделя/день без «заборов», радиус единый, баннер/настройки/промоут работают.

- [ ] **Step 3: Коммит доков**

```bash
git add docs/superpowers/specs/2026-08-03-ui-lines-radius-design.md docs/superpowers/plans/2026-08-03-ui-lines-radius.md
git commit -m "docs: спека и план «Меньше линий, единый радиус»"
```
