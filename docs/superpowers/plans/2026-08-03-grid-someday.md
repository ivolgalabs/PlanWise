# Сетка 2 линии + textarea + «Когда-нибудь» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Сетка недели в 2 линии (Пн–Чт сверху, Пт–Вс снизу) — колонки ~330-440px; (2) перенос длинного текста задач в сетке через авто-растущий textarea; (3) колонка «Когда-нибудь» (задачи без даты, как Someday в tweek.so) в «Неделе» и «Дне» с drag в обе стороны.

**Architecture:** SQLite: миграция V5 — флаг `someday INTEGER NOT NULL DEFAULT 0` (date остаётся NOT NULL; у someday-задач date=0). Rust: `get_tasks` фильтрует `someday = 0`, новые команды `get_someday_tasks`/`set_someday`, `move_task` снимает флаг, rollover исключает. Фронт: `App.reload` объединяет обычные + someday-задачи в store (виды фильтруют по дате, поиск видит все). WeekView: два ряда по 4+3 колонки. TaskCard в compact: textarea с авто-высотой (Enter — сохранить+следующая, Shift+Enter — перенос). Новый компонент `SomedayColumn` (droppable-зона `sd:someday`) в WeekView и DayView + настройка `visibility.someday`.

**Tech Stack:** Tauri v2, rusqlite/refinery, React 19 + TS, dnd-kit, zustand.

## Global Constraints

- Версия JSON-бэкапа остаётся `1`; новые поля при импорте — опционально.
- Сборка Rust — в общий target (`~/.cargo-shared-target`), параллельных сборок не запускать.
- Комментарии — на русском, в стиле окружающего кода.
- Проверка каждой задачи: `cargo test --lib`/`cargo check` (Rust) или `npx tsc --noEmit` (TS) + браузерная проверка (:1100, фоллбек).
- Коммиты — после каждой задачи (пользователь разрешил), message из задачи.

---

### Task 1: Миграция V5 + модель + команды Rust (TDD)

**Files:**
- Create: `src-tauri/migrations/V5__someday.sql`
- Modify: `src-tauri/src/db.rs` (тест V5)
- Modify: `src-tauri/src/models.rs` (поле someday + тест serde)
- Modify: `src-tauri/src/commands.rs` (get_tasks, get_someday_tasks, set_someday, move_task, rollover_overdue, upsert_task, export_to, import_from)

**Interfaces:**
- Produces: `Task.someday: bool` (`#[serde(default)]`); команды `get_someday_tasks() -> Vec<Task>`, `set_someday(id: String)`; `get_tasks` возвращает только `someday = 0`; `move_task(id, new_date)` снимает `someday`; `rollover_overdue` исключает someday; `upsert_task` принимает/сохраняет someday; экспорт/импорт — поле `"someday"`.

- [ ] **Step 1: Падающие тесты**

В `src-tauri/src/db.rs` в `mod tests` добавить тест:

```rust
    /// V5: у tasks есть колонка someday с default 0.
    #[test]
    fn migrations_add_someday_column() {
        let conn = open(":memory:");
        let has: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'someday'",
                [],
                |row| row.get(0),
            )
            .expect("pragma someday");
        assert!(has, "после миграций у tasks должна быть колонка someday");
        let default: i64 = conn
            .query_row(
                "SELECT someday FROM tasks WHERE id = 'x'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(default, 0);
    }
```

(Второй запрос вернёт 0 через unwrap_or — колонка с NOT NULL DEFAULT 0. Проверка наличия колонки — главная.)

В `src-tauri/src/models.rs` в `mod tests` добавить:

```rust
    /// Старый JSON без someday десериализуется в false.
    #[test]
    fn task_deserializes_without_someday() {
        let t: Task = serde_json::from_value(serde_json::json!({
            "id": "a", "title": "T", "date": 0, "isDone": false,
            "colorSetId": null, "sortOrder": 0.0, "createdAt": 0,
            "updatedAt": 0, "deviceId": "d", "timeMinutes": null,
            "notes": "",
        }))
        .expect("parse task without someday");
        assert!(!t.someday);
    }
```

- [ ] **Step 2: Убедиться, что падают**

Run: `cd src-tauri && cargo test --lib`
Expected: FAIL — `missing field 'someday'` (тест serde).

- [ ] **Step 3: Миграция и модель**

Создать `src-tauri/migrations/V5__someday.sql`:

```sql
-- «Когда-нибудь»: задача без привязки ко дню (date игнорируется, = 0).
ALTER TABLE tasks ADD COLUMN someday INTEGER NOT NULL DEFAULT 0;
```

В `src-tauri/src/models.rs` в `Task` после `notes`:

```rust
    #[serde(default)]
    pub someday: bool, // «Когда-нибудь»: задача без привязки ко дню
```

- [ ] **Step 4: Тесты зелёные**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — 4 теста (2 старых + 2 новых).

- [ ] **Step 5: Команды — get_tasks**

Заменить SELECT и конструктор в `get_tasks`:

```rust
        let mut stmt = conn
            .prepare(
                "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday
                 FROM tasks WHERE date BETWEEN ?1 AND ?2 AND someday = 0
                 ORDER BY time_minutes IS NULL, time_minutes ASC, sort_order ASC",
            )
            .expect("prepare get_tasks");
        stmt.query_map([start_day, end_day], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                date: row.get(2)?,
                is_done: row.get::<_, i64>(3)? != 0,
                color_set_id: row.get(4)?,
                sort_order: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                device_id: row.get(8)?,
                time_minutes: row.get(9)?,
                notes: row.get(10)?,
                someday: row.get::<_, i64>(11)? != 0,
            })
        })
```

- [ ] **Step 6: Новые команды get_someday_tasks и set_someday**

В `src-tauri/src/commands.rs` после `move_task` добавить:

```rust
/// Задачи «Когда-нибудь» — без привязки ко дню.
#[tauri::command]
pub fn get_someday_tasks(state: State<'_, Db>) -> Vec<Task> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday
             FROM tasks WHERE someday = 1 ORDER BY sort_order ASC, created_at ASC",
        )
        .expect("prepare get_someday_tasks");
    stmt.query_map([], |row| {
        Ok(Task {
            id: row.get(0)?,
            title: row.get(1)?,
            date: row.get(2)?,
            is_done: row.get::<_, i64>(3)? != 0,
            color_set_id: row.get(4)?,
            sort_order: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            device_id: row.get(8)?,
            time_minutes: row.get(9)?,
            notes: row.get(10)?,
            someday: row.get::<_, i64>(11)? != 0,
        })
    })
    .expect("query get_someday_tasks")
    .filter_map(|r| r.ok())
    .collect()
}

/// Переместить задачу в «Когда-нибудь» (дата сбрасывается).
#[tauri::command]
pub fn set_someday(state: State<'_, Db>, id: String) {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "UPDATE tasks SET someday = 1, date = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now_ms(), id],
    )
    .expect("set_someday");
}
```

- [ ] **Step 7: move_task и rollover**

`move_task` — заменить UPDATE:

```rust
    conn.execute(
        "UPDATE tasks SET date = ?1, someday = 0, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_date, now_ms(), id],
    )
    .expect("move_task");
```

`rollover_overdue` — оба SQL-запроса (`SELECT COUNT(*)` и `UPDATE`) дополнить `AND someday = 0`:

```rust
            "SELECT COUNT(*) FROM tasks WHERE is_done = 0 AND date < ?1 AND someday = 0",
```
```rust
        "UPDATE tasks SET date = ?1, updated_at = ?2 WHERE is_done = 0 AND date < ?1 AND someday = 0",
```

- [ ] **Step 8: upsert_task**

INSERT/ON CONFLICT с someday (12 колонок):

```rust
    conn.execute(
        "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, date=excluded.date, is_done=excluded.is_done,
           color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
           updated_at=excluded.updated_at, device_id=excluded.device_id,
           time_minutes=excluded.time_minutes, notes=excluded.notes,
           someday=excluded.someday",
        rusqlite::params![
            task.id,
            task.title,
            task.date,
            task.is_done as i64,
            task.color_set_id,
            task.sort_order,
            task.created_at,
            task.updated_at,
            task.device_id,
            task.time_minutes,
            task.notes,
            task.someday as i64,
        ],
    )
    .expect("upsert_task execute");
```

- [ ] **Step 9: export_to и import_from**

В `export_to` блок задач: SELECT дополнить `, someday` и в JSON добавить:

```rust
                    "notes": r.get::<_, String>(10)?,
                    "someday": r.get::<_, i64>(11)? != 0,
```

В `import_from` INSERT задач — 12 колонок, добавить параметр:

```rust
                t.get("notes").and_then(|x| x.as_str()).unwrap_or(""),
                t.get("someday").and_then(|x| x.as_bool()).unwrap_or(false) as i64,
```

- [ ] **Step 10: Регистрация команд и проверка**

В `src-tauri/src/lib.rs` в `generate_handler!` добавить:

```rust
            commands::get_someday_tasks,
            commands::set_someday,
```

Run: `cd src-tauri && cargo test --lib && cargo check`
Expected: 4 теста PASS, check чистый.

- [ ] **Step 11: Коммит**

```bash
git add src-tauri/migrations/V5__someday.sql src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: «Когда-нибудь» — флаг someday, команды, фильтрация, rollover"
```

---

### Task 2: Фронт — типы, API, фоллбек, пул задач в App

**Files:**
- Modify: `src/api.ts` (Task.someday, getSomedayTasks, setSomeday, upsertTask)
- Modify: `src/api-browser-fallback.ts` (someday во всех операциях)
- Modify: `src/App.tsx` (reload объединяет обычные + someday)

**Interfaces:**
- Consumes: Rust-команды `get_someday_tasks`, `set_someday` (Task 1).
- Produces: `Task.someday: boolean`; `api.getSomedayTasks()`, `api.setSomeday(id)`; фоллбек синхронен; `store.tasks` содержит обычные + someday-задачи (виды фильтруют по дате, `SomedayColumn` — по флагу).

- [ ] **Step 1: api.ts**

В интерфейсе `Task` после `notes`:

```ts
  someday: boolean; // «Когда-нибудь»: задача без привязки ко дню
```

В `upsertTask` сборке объекта после `notes`:

```ts
      notes: task.notes ?? "",
      someday: task.someday ?? false,
```

Добавить методы в `api` (после `moveTask`):

```ts
  /** Задачи «Когда-нибудь» (без даты). */
  getSomedayTasks: () => (isTauri() ? invoke<Task[]>("get_someday_tasks") : browserApi.getSomedayTasks()),
  /** Переместить задачу в «Когда-нибудь» (дата сбрасывается). */
  setSomeday: (id: string) => (isTauri() ? invoke<void>("set_someday", { id }) : browserApi.setSomeday(id)),
```

- [ ] **Step 2: api-browser-fallback.ts**

В `getTasks` фильтр дополнить:

```ts
      .filter((t) => !t.someday && t.date >= startDay && t.date <= endDay)
```

Добавить методы (после `moveTask`):

```ts
  async getSomedayTasks(): Promise<Task[]> {
    return sortTasks(load<Task>(K.tasks).filter((t) => t.someday));
  },
  async setSomeday(id: string): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, someday: true, date: 0, notes: t.notes ?? "" } : t)));
  },
```

`moveTask` — снимать someday:

```ts
  async moveTask(id: string, newDay: number): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, date: newDay, someday: false, notes: t.notes ?? "" } : t)));
  },
```

`rolloverOverdue` — исключить someday:

```ts
      if (t.date < todayDay && !t.isDone && !t.someday) {
```

`upsertTask` — нормализация someday (старые записи):

```ts
    const rec: Task = { ...task, id, notes: task.notes ?? "", someday: task.someday ?? false };
```

- [ ] **Step 3: App.tsx — пул задач**

Заменить `reload`:

```ts
  const reload = useCallback(async () => {
    // Обычные задачи (широкий диапазон для календаря) + «Когда-нибудь».
    const [regular, someday] = await Promise.all([
      api.getTasks(new Date(0), new Date(9999, 0, 1)),
      api.getSomedayTasks(),
    ]);
    setTasks([...regular, ...someday]);
  }, [setTasks]);
```

- [ ] **Step 4: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 5: Коммит**

```bash
git add src/api.ts src/api-browser-fallback.ts src/App.tsx
git commit -m "feat: someday на фронте — типы, API, фоллбек, пул задач"
```

---

### Task 3: Сетка недели — 2 линии (4+3)

**Files:**
- Modify: `src/views/WeekView.tsx` (горизонтальный режим)

**Interfaces:**
- Consumes: `days`, `tasksForDay`, `DayColumn`, `WeekShiftZone` (существующие).
- Produces: сетка из двух рядов: верх — `days[0..4]`, низ — `days[4..7]`; колонки равные (`flex: 1`, без min/max 140-360).

- [ ] **Step 1: Заменить горизонтальную разметку**

В `src/views/WeekView.tsx` в не-вертикальной ветке заменить блок с `{days.map((d) => {...})}` (от `<div style={{ display: "flex", gap: 4, padding: 4, flex: 1, ... }}>` до закрывающего `</div>` перед `</div>` с `WeekShiftZone dir={1}`) на:

```tsx
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4, flex: 1, minWidth: 0, height: "100%", minHeight: 0 }}>
                {/* Два ряда: Пн–Чт сверху, Пт–Вс снизу. Колонки равные и
                    широкие — текст задач читается без обрезки. */}
                {[days.slice(0, 4), days.slice(4)].map((row, ri) => (
                  <div key={ri} style={{ display: "flex", gap: 4, flex: 1, minHeight: 0 }}>
                    {row.map((d) => (
                      <div key={d.toISOString()} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                        <DayColumn day={d} tasks={tasksForDay(d)} onChange={onChange} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
```

(Удалить старые today-переменную `const today = dayWeight(d) === "today";` и min/maxWidth — больше не нужны; при необходимости удалить неиспользуемый импорт `dayWeight`.)

- [ ] **Step 2: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 3: Браузерная проверка**

Неделя → «сеткой»: два ряда (4+3), колонки ~330/440px, текст задач читается (без обрезки на 12px), скролл внутри колонок работает, drag между колонками работает, календарь справа на месте.

- [ ] **Step 4: Коммит**

```bash
git add src/views/WeekView.tsx
git commit -m "feat: сетка недели в 2 линии (4+3) — широкие читаемые колонки"
```

---

### Task 4: TaskCard compact — авто-растущий textarea

**Files:**
- Modify: `src/components/TaskCard.tsx`

**Interfaces:**
- Consumes: пропсы `compact`, `title`/`setTitle`, `save`, `onKeyDown`-логика, `onCreateNext`, `del`, `savedRef`.
- Produces: в `compact`-режиме вместо `<input>` — `<textarea>` с переносом по словам и авто-высотой; Enter — сохранить и создать следующую (Shift+Enter — перенос строки); в не-компактном — прежний `<input>`.

- [ ] **Step 1: textareaRef и авто-высота**

После `inputRef` добавить:

```tsx
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Авто-высота textarea компактной сетки: растёт по контенту, максимум ~4 строки.
  const growCompactTitle = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px";
  };
```

После useEffect синхронизации title (и notes) добавить:

```tsx
  // При изменении текста/открытии — подгоняем высоту textarea компактной сетки.
  useEffect(() => {
    if (compact && textareaRef.current) growCompactTitle(textareaRef.current);
  }, [title, compact]);
```

- [ ] **Step 2: Условный рендер input/textarea**

В `src/components/TaskCard.tsx` внутри контейнера-колонки заменить блок `<input ... data-task-id={task.id} title={title || undefined} />` на:

```tsx
        {compact ? (
          <textarea
            ref={textareaRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              setEditing(false);
              save();
            }}
            onKeyDown={onKeyDown}
            onInput={(e) => growCompactTitle(e.currentTarget)}
            rows={1}
            data-task-id={task.id}
            title={title || undefined}
            style={{
              flex: 1,
              width: "100%",
              fontSize: "inherit",
              border: "none",
              background: "transparent",
              outline: "none",
              padding: "4px 0",
              minWidth: 0,
              resize: "none",
              overflow: "hidden",
              lineHeight: 1.4,
              color: task.isDone ? COLORS.muted : COLORS.text,
              textDecoration: task.isDone ? "line-through" : "none",
            }}
          />
        ) : (
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              setEditing(false);
              save();
            }}
            onKeyDown={onKeyDown}
            style={{
              flex: 1,
              width: "100%",
              fontSize: "inherit",
              border: "none",
              background: "transparent",
              outline: "none",
              padding: "4px 0",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: task.isDone ? COLORS.muted : COLORS.text,
              textDecoration: task.isDone ? "line-through" : "none",
            }}
            data-task-id={task.id}
            title={title || undefined}
          />
        )}
```

- [ ] **Step 3: Enter в textarea — Shift+Enter перенос строки**

В `onKeyDown` (функция в TaskCard) обновить обработку Enter — первая строка сейчас:

```tsx
  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
```

заменить на (тип события расширяется на оба элемента):

```tsx
  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
```

(остальная логика без изменений: Enter — сохранить + создать следующую; Shift+Enter в textarea — стандартный перенос строки, React не перехватывает)

- [ ] **Step 4: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 5: Браузерная проверка**

Неделя → «сеткой»: длинная задача («Созвон с командой по релизу новой версии приложения») переносится на 2-3 строки, высота строки растёт; Enter — сохраняет и создаёт следующую строку; Shift+Enter — перенос строки в тексте; DayView/список — обычный input, без изменений.

- [ ] **Step 6: Коммит**

```bash
git add src/components/TaskCard.tsx
git commit -m "feat: сетка — авто-растущий textarea с переносом текста"
```

---

### Task 5: Колонка «Когда-нибудь» + drag + размещение

**Files:**
- Create: `src/components/SomedayColumn.tsx`
- Modify: `src/drag.tsx` (зона `sd:someday`, onDragEnd)
- Modify: `src/views/WeekView.tsx` (размещение справа)
- Modify: `src/views/DayView.tsx` (размещение справа)
- Modify: `src/store.ts` (visibility.someday)
- Modify: `src/components/SettingsPanel.tsx` (строка настройки)

**Interfaces:**
- Consumes: `Task.someday` (Task 2), `api.setSomeday`/`api.upsertTask` (Task 2), пул задач в store (Task 2), `TaskCard`, `COLORS`/`accentTint` (theme), `useDroppable` (dnd-kit), `somedayZoneId` (эта задача).
- Produces: `somedayZoneId = "sd:someday"` в drag.tsx; `SomedayColumn({ tasks, onChange })` — droppable-зона, список TaskCard, поле «+»; в WeekView и DayView справа; drag задача→«Когда-нибудь» и обратно.

- [ ] **Step 1: drag.tsx — зона и обработка**

В `src/drag.tsx` после `weekShiftId` добавить:

```ts
/** id droppable-зоны «Когда-нибудь» (колонка задач без даты). */
export const somedayZoneId = "sd:someday";
```

В `onDragEnd` в ветке `if (task)` перед проверкой `w:prev/w:next` добавить:

```ts
      // Задача → «Когда-нибудь»: снять привязку ко дню.
      if (over === somedayZoneId) {
        await api.setSomeday(task.id);
        onChange();
        return;
      }
```

(Задача из «Когда-нибудь» → день обрабатывается существующим `parseDayId` + `moveTask` — `someday` снимается в Rust.)

- [ ] **Step 2: Создать SomedayColumn.tsx**

```tsx
import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint } from "../theme";
import { TaskCard } from "./TaskCard";
import { somedayZoneId } from "../drag";

interface Props {
  tasks: Task[];
  onChange: () => void;
}

/** Колонка «Когда-нибудь» (аналог Someday в tweek): задачи без привязки ко дню.
 *  Принимает задачи drag-ом; перенос в день — обычным drag на колонку дня. */
export function SomedayColumn({ tasks, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const { setNodeRef, isOver } = useDroppable({ id: somedayZoneId });

  const add = async () => {
    const t = newTitle.trim();
    if (!t) return;
    await api.upsertTask({ title: t, date: 0, someday: true });
    setNewTitle("");
    onChange();
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: `1px solid ${COLORS.cardBorder}`,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: isOver ? accentTint(0.08) : undefined,
      }}
    >
      <div
        style={{
          padding: "var(--sp-2) var(--sp-3)",
          fontSize: "var(--fs-sm)",
          fontWeight: 700,
          color: COLORS.accent,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
        }}
      >
        Когда-нибудь
        <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, fontWeight: 400 }}>
          {tasks.length}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 4 }}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onChange={onChange} showTime={false} />
        ))}
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
            Задачи без даты. Перетащите сюда или напишите ниже.
          </p>
        )}
      </div>
      <input
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="+ когда-нибудь"
        style={{
          width: "100%",
          border: "none",
          borderTop: `1px solid ${COLORS.cardBorder}`,
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          outline: "none",
          color: COLORS.text,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: WeekView — размещение**

В `src/views/WeekView.tsx`: рядом с `{showCal && !narrow && !calNarrow && (<RightCalendar .../>)}` добавить (перед календарём):

```tsx
        {/* Колонка «Когда-нибудь» — справа от сетки (скрывается настройкой
            и в узком окне, как календарь). */}
        {visibility.someday && !narrow && (
          <SomedayColumn tasks={tasks.filter((t) => t.someday)} onChange={onChange} />
        )}
```

Импорт: `import { SomedayColumn } from "../components/SomedayColumn";`

- [ ] **Step 4: DayView — размещение**

В `src/views/DayView.tsx`: найти правую панель с мини-календарём (MiniCalendar) и добавить перед ней (или после — по месту) колонку:

```tsx
        {visibility.someday && (
          <SomedayColumn tasks={tasks.filter((t) => t.someday)} onChange={onChange} />
        )}
```

Импорт `SomedayColumn`; `visibility` и `tasks` в DayView уже доступны (проверить по файлу — tasks приходит пропсом, visibility из стора; если visibility не извлекается — добавить `const { visibility } = useStore();`).

- [ ] **Step 5: Настройка видимости**

`src/store.ts`: в `VisibilityState` и `DEFAULT_VISIBILITY` добавить `someday: true` (после `notes`).

`src/components/SettingsPanel.tsx`: в массив «Интерфейс» после `["notes", "Заметки"],`:

```tsx
              ["someday", "«Когда-нибудь»"],
```

- [ ] **Step 6: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 7: Браузерная проверка**

Неделя: колонка «Когда-нибудь» справа; «+ когда-нибудь» создаёт задачу; drag задачи на колонку — уходит в «Когда-нибудь» (исчезает из дня, появляется в колонке); drag из «Когда-нибудь» на день — появляется в дне; перезагрузка — задачи на месте; настройка ««Когда-нибудь»» off/on — колонка скрывается/появляется; поиск находит someday-задачи. День: колонка справа работает так же.

- [ ] **Step 8: Коммит**

```bash
git add src/components/SomedayColumn.tsx src/drag.tsx src/views/WeekView.tsx src/views/DayView.tsx src/store.ts src/components/SettingsPanel.tsx
git commit -m "feat: колонка «Когда-нибудь» — задачи без даты, drag, настройка"
```

---

### Task 6: Финальная верификация + доки

**Files:** нет кодовых правок — проверки и коммит доков.

- [ ] **Step 1: Rust-тесты и компиляция**

Run: `cd src-tauri && cargo test --lib && cargo check`
Expected: 4 теста PASS, check чистый.

- [ ] **Step 2: Полная сборка фронта**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npm run build`
Expected: tsc + vite build без ошибок.

- [ ] **Step 3: Сквозная браузерная проверка**

Неделя (2 линии), перенос текста, «Когда-нибудь» (создание/drag/возврат/настройка), поиск, месяц (перенос не сломан), экспорт/импорт полей someday (визуально — фоллбек не имеет экспорта; проверяется в Tauri).

- [ ] **Step 4: Коммит доков**

```bash
git add docs/superpowers/specs/2026-08-03-grid-someday-design.md docs/superpowers/plans/2026-08-03-grid-someday.md
git commit -m "docs: спека и план «Сетка 2 линии + Когда-нибудь»"
```
