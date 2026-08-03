# Панель «Календарь + Когда-нибудь», переносы, заметки Enter, произвольный период, архив — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) «Когда-нибудь» переезжает под календарь в одну правую панель (неделя и день) с кнопкой сворачивания всей панели; (2) перенос текста задач во всех строках (textarea); (3) заметки: Enter — применить, Shift+Enter — новая строка; (4) сортировку по времени убрать; (5) период «Произвольный» в поиске; (6) архив просроченных задач (миграция V6) с полоской в панели и возвратом на выбранную дату.

**Architecture:** SQLite: миграция V6 — флаг `archived INTEGER NOT NULL DEFAULT 0` (как someday). Rust: `get_tasks`/`get_someday_tasks` фильтруют `archived = 0`, новые команды `archive_overdue` (заменяет `rollover_overdue`), `get_archived_tasks`, `restore_archived(id, date)`; `get_tasks` сортирует только по `sort_order`. Фронт: `App.reload` грузит 3 пула (обычные + someday + архив в `store.archivedTasks`); авто-архив при старте вместо переноса на сегодня; новая правая панель `RightPanel` (MiniCalendar + SomedayColumn-секция + полоска «Архив · N», разворот — `ArchivePanel` с `DatePickerModal` для выбора даты возврата); `TaskCard` — единый авто-растущий textarea во всех режимах; поиск — `PeriodFilter "custom"` с диапазоном «с/по».

**Tech Stack:** Tauri v2, rusqlite/refinery, React 19 + TS, dnd-kit, zustand.

## Global Constraints

- Версия JSON-бэкапа остаётся `1`; новые поля при импорте — опционально.
- Сборка Rust — в общий target (`~/.cargo-shared-target`), параллельных сборок не запускать.
- Комментарии — на русском, в стиле окружающего кода.
- Проверка каждой задачи: `cargo test --lib`/`cargo check` (Rust) или `npx tsc --noEmit` (TS) + браузерная проверка (:1100, фоллбек).
- Коммиты — после каждой задачи (как в прошлых итерациях; при старте исполнения уточнить у пользователя).

---

### Task 1: Rust — миграция V6, модель archived, команды архива, сортировка только sortOrder (TDD)

**Files:**
- Create: `src-tauri/migrations/V6__archive.sql`
- Modify: `src-tauri/src/db.rs` (тест V6)
- Modify: `src-tauri/src/models.rs` (поле archived + тест serde)
- Modify: `src-tauri/src/commands.rs` (get_tasks, upsert_task, move_task, get_someday_tasks, set_someday, rollover_overdue → archive_overdue, get_archived_tasks, restore_archived, export_to, import_from)
- Modify: `src-tauri/src/lib.rs` (регистрация команд)

**Interfaces:**
- Consumes: существующие `Task`, `Db`, `now_ms()`.
- Produces: `Task.archived: bool` (`#[serde(default)]`); команды `archive_overdue(today_epoch_day: i64) -> i64`, `get_archived_tasks() -> Vec<Task>`, `restore_archived(id: String, date: i64)`; `get_tasks` → `ORDER BY sort_order ASC` и `AND archived = 0`; `rollover_overdue` удалена.

- [ ] **Step 1: Падающие тесты**

В `src-tauri/src/db.rs` в `mod tests` добавить:

```rust
    /// V6: у tasks есть колонка archived с default 0.
    #[test]
    fn migrations_add_archived_column() {
        let conn = open(":memory:");
        let has: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'archived'",
                [],
                |row| row.get(0),
            )
            .expect("pragma archived");
        assert!(has, "после миграций у tasks должна быть колонка archived");
        let default: i64 = conn
            .query_row(
                "SELECT archived FROM tasks WHERE id = 'x'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(default, 0);
    }
```

В `src-tauri/src/models.rs` в `mod tests` добавить:

```rust
    /// Старый JSON без archived десериализуется в false.
    #[test]
    fn task_deserializes_without_archived() {
        let t: Task = serde_json::from_value(serde_json::json!({
            "id": "a", "title": "T", "date": 0, "isDone": false,
            "colorSetId": null, "sortOrder": 0.0, "createdAt": 0,
            "updatedAt": 0, "deviceId": "d", "timeMinutes": null,
            "notes": "", "someday": false,
        }))
        .expect("parse task without archived");
        assert!(!t.archived);
    }
```

- [ ] **Step 2: Убедиться, что падают**

Run: `cd src-tauri && cargo test --lib`
Expected: FAIL — `missing field 'archived'` (тест serde).

- [ ] **Step 3: Миграция и модель**

Создать `src-tauri/migrations/V6__archive.sql`:

```sql
-- «Архив»: задача скрыта из видов, ждёт возврата (archived = 1).
ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
```

В `src-tauri/src/models.rs` в `Task` после `someday`:

```rust
    #[serde(default)]
    pub archived: bool, // «Архив»: задача скрыта из видов, ждёт возврата
```

- [ ] **Step 4: Тесты зелёные**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — 6 тестов (3 миграции + 3 serde).

- [ ] **Step 5: get_tasks — архив и сортировка**

Заменить SELECT и конструктор в `get_tasks` (12 → 13 колонок, `ORDER BY sort_order ASC`):

```rust
        let mut stmt = conn
            .prepare(
                "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived
                 FROM tasks WHERE date BETWEEN ?1 AND ?2 AND someday = 0 AND archived = 0
                 ORDER BY sort_order ASC",
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
                archived: row.get::<_, i64>(12)? != 0,
            })
        })
```

- [ ] **Step 6: upsert_task, move_task, get_someday_tasks, set_someday**

`upsert_task` — 13 колонок:

```rust
    conn.execute(
        "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, date=excluded.date, is_done=excluded.is_done,
           color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
           updated_at=excluded.updated_at, device_id=excluded.device_id,
           time_minutes=excluded.time_minutes, notes=excluded.notes,
           someday=excluded.someday, archived=excluded.archived",
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
            task.archived as i64,
        ],
    )
```

`move_task` — UPDATE дополнить `archived = 0`:

```rust
        "UPDATE tasks SET date = ?1, someday = 0, archived = 0, updated_at = ?2 WHERE id = ?3",
```

`get_someday_tasks` — SELECT + конструктор как в Step 5 (13 колонок), WHERE:

```rust
             FROM tasks WHERE someday = 1 AND archived = 0 ORDER BY sort_order ASC, created_at ASC",
```

`set_someday` — UPDATE дополнить `archived = 0`:

```rust
        "UPDATE tasks SET someday = 1, date = 0, archived = 0, updated_at = ?1 WHERE id = ?2",
```

- [ ] **Step 7: archive_overdue вместо rollover_overdue**

Заменить всю функцию `rollover_overdue` на:

```rust
/// Перенос просроченных невыполненных задач в «Архив» (вместо переноса на
/// сегодня). Возвращает количество заархивированных задач (для баннера в UI).
#[tauri::command]
pub fn archive_overdue(state: State<'_, Db>, today_epoch_day: i64) -> i64 {
    let conn = state.0.lock().unwrap();
    // Сначала считаем, сколько строк затронем.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE is_done = 0 AND date < ?1 AND someday = 0 AND archived = 0",
            [today_epoch_day],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if count == 0 {
        return 0;
    }
    conn.execute(
        "UPDATE tasks SET archived = 1, updated_at = ?1 WHERE is_done = 0 AND date < ?2 AND someday = 0 AND archived = 0",
        rusqlite::params![now_ms(), today_epoch_day],
    )
    .expect("archive_overdue execute");
    count
}
```

- [ ] **Step 8: get_archived_tasks и restore_archived**

После `set_someday` добавить:

```rust
/// Задачи «Архива» — скрытые из видов, ждут возврата на дату.
#[tauri::command]
pub fn get_archived_tasks(state: State<'_, Db>) -> Vec<Task> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived
             FROM tasks WHERE archived = 1 ORDER BY date DESC, updated_at DESC",
        )
        .expect("prepare get_archived_tasks");
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
            archived: row.get::<_, i64>(12)? != 0,
        })
    })
    .expect("query get_archived_tasks")
    .filter_map(|r| r.ok())
    .collect()
}

/// Вернуть задачу из «Архива» на выбранную дату (archived снимается).
#[tauri::command]
pub fn restore_archived(state: State<'_, Db>, id: String, date: i64) {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "UPDATE tasks SET archived = 0, date = ?1, someday = 0, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![date, now_ms(), id],
    )
    .expect("restore_archived");
}
```

- [ ] **Step 9: export_to и import_from**

В `export_to` блок задач: SELECT дополнить `, archived`, в JSON добавить:

```rust
                    "archived": r.get::<_, i64>(12)? != 0,
```

В `import_from` INSERT задач — 13 колонок и параметр:

```rust
            "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                t.get("id").and_then(|x| x.as_str()).unwrap_or(""),
                t.get("title").and_then(|x| x.as_str()).unwrap_or(""),
                t.get("date").and_then(|x| x.as_i64()).unwrap_or(0),
                t.get("isDone").and_then(|x| x.as_bool()).unwrap_or(false) as i64,
                t.get("colorSetId").and_then(|x| x.as_str()),
                t.get("sortOrder").and_then(|x| x.as_f64()).unwrap_or(0.0),
                t.get("createdAt").and_then(|x| x.as_i64()).unwrap_or(0),
                t.get("updatedAt").and_then(|x| x.as_i64()).unwrap_or(0),
                t.get("deviceId").and_then(|x| x.as_str()).unwrap_or(""),
                t.get("timeMinutes").and_then(|x| x.as_i64()),
                t.get("notes").and_then(|x| x.as_str()).unwrap_or(""),
                t.get("someday").and_then(|x| x.as_bool()).unwrap_or(false) as i64,
                t.get("archived").and_then(|x| x.as_bool()).unwrap_or(false) as i64,
            ],
```

- [ ] **Step 10: lib.rs — регистрация команд**

В `src-tauri/src/lib.rs` в `generate_handler!` заменить `commands::rollover_overdue,` на:

```rust
            commands::archive_overdue,
            commands::get_archived_tasks,
            commands::restore_archived,
```

- [ ] **Step 11: Проверка**

Run: `cd src-tauri && cargo test --lib && cargo check`
Expected: 6 тестов PASS, check чистый.

- [ ] **Step 12: Коммит**

```bash
git add src-tauri/migrations/V6__archive.sql src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: архив — миграция V6, команды archive/get/restore, сортировка только sortOrder"
```

---

### Task 2: Фронт — типы, API, фоллбек, store, App, настройки

**Files:**
- Modify: `src/api.ts` (Task.archived, archiveOverdue, getArchivedTasks, restoreArchived; rolloverOverdue удалить)
- Modify: `src/api-browser-fallback.ts` (фильтры archived, archiveOverdue, restoreArchived, getArchivedTasks; sortTasks без времени)
- Modify: `src/store.ts` (archivedTasks, archiveEnabled, visibility.archiveBanner)
- Modify: `src/App.tsx` (reload 3 пула, авто-архив, баннер)
- Modify: `src/components/SettingsPanel.tsx` (подпись настройки, строка баннера)

**Interfaces:**
- Consumes: Rust-команды Task 1 (`archive_overdue`, `get_archived_tasks`, `restore_archived`).
- Produces: `Task.archived: boolean`; `api.archiveOverdue(today: Date): Promise<number>`, `api.getArchivedTasks(): Promise<Task[]>`, `api.restoreArchived(id: string, date: Date): Promise<void>`; `store.archivedTasks: Task[]`, `store.setArchivedTasks(t: Task[])`, `store.archiveEnabled: boolean`, `store.setArchiveEnabled(v: boolean)`, `visibility.archiveBanner`.

- [ ] **Step 1: api.ts**

В интерфейсе `Task` после `someday`:

```ts
  archived: boolean; // «Архив»: скрыта из видов, ждёт возврата
```

В `upsertTask` сборке объекта после `someday`:

```ts
      archived: task.archived ?? false,
```

Заменить `rolloverOverdue` на три метода (после `setSomeday`):

```ts
  /** Архив: просроченные невыполненные задачи. Возвращает кол-во. */
  archiveOverdue: (today: Date) => {
    const td = toEpochDay(today);
    return isTauri() ? invoke<number>("archive_overdue", { todayEpochDay: td }) : browserApi.archiveOverdue(td);
  },
  /** Задачи «Архива» (скрыты из видов, ждут возврата). */
  getArchivedTasks: () => (isTauri() ? invoke<Task[]>("get_archived_tasks") : browserApi.getArchivedTasks()),
  /** Вернуть задачу из архива на выбранную дату. */
  restoreArchived: (id: string, date: Date) => {
    const d = toEpochDay(date);
    return isTauri() ? invoke<void>("restore_archived", { id, date: d }) : browserApi.restoreArchived(id, d);
  },
```

- [ ] **Step 2: api-browser-fallback.ts**

`sortTasks` — только ручной порядок:

```ts
const sortTasks = (arr: Task[]): Task[] =>
  arr.sort((a, b) => a.sortOrder - b.sortOrder);
```

`getTasks` — фильтр и нормализация:

```ts
    return sortTasks(
      load<Task>(K.tasks)
        .filter((t) => !t.someday && !t.archived && t.date >= startDay && t.date <= endDay)
        .map((t) => ({ ...t, notes: t.notes ?? "", archived: t.archived ?? false })),
    );
```

`upsertTask` — нормализация archived:

```ts
    const rec: Task = { ...task, id, notes: task.notes ?? "", someday: task.someday ?? false, archived: task.archived ?? false };
```

`moveTask` / `setSomeday` — снимать archived:

```ts
  async moveTask(id: string, newDay: number): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, date: newDay, someday: false, archived: false, notes: t.notes ?? "" } : t)));
  },
```
```ts
  async setSomeday(id: string): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, someday: true, date: 0, archived: false, notes: t.notes ?? "" } : t)));
  },
```

`getSomedayTasks` — фильтр archived:

```ts
  async getSomedayTasks(): Promise<Task[]> {
    return sortTasks(load<Task>(K.tasks).filter((t) => t.someday && !t.archived));
  },
```

`rolloverOverdue` → `archiveOverdue`, и добавить `getArchivedTasks`/`restoreArchived`:

```ts
  async archiveOverdue(todayDay: number): Promise<number> {
    let n = 0;
    save(K.tasks, load<Task>(K.tasks).map((t) => {
      if (t.date < todayDay && !t.isDone && !t.someday && !t.archived) { n++; return { ...t, archived: true }; }
      return t;
    }));
    return n;
  },
  async getArchivedTasks(): Promise<Task[]> {
    return load<Task>(K.tasks)
      .filter((t) => t.archived)
      .map((t) => ({ ...t, notes: t.notes ?? "", archived: t.archived ?? false }))
      .sort((a, b) => b.date - a.date || b.updatedAt - a.updatedAt);
  },
  async restoreArchived(id: string, date: number): Promise<void> {
    save(K.tasks, load<Task>(K.tasks).map((t) => (t.id === id ? { ...t, archived: false, date, someday: false, notes: t.notes ?? "" } : t)));
  },
```

- [ ] **Step 3: store.ts**

`VisibilityState`: заменить `rolloverBanner: boolean;` на `archiveBanner: boolean;`.
`DEFAULT_VISIBILITY`: заменить `rolloverBanner: true` на `archiveBanner: true`.
`PlannerState`: заменить `rolloverEnabled: boolean;` на `archiveEnabled: boolean;`, `setRolloverEnabled: (v: boolean) => void;` на `setArchiveEnabled: (v: boolean) => void;`, после `tasks: Task[];` добавить `archivedTasks: Task[];` и после `setTasks` — `setArchivedTasks: (t: Task[]) => void;`.
Инициализация: `archiveEnabled: true,` (вместо rolloverEnabled), `archivedTasks: [],`, сеттеры:

```ts
      setArchiveEnabled: (v) => set({ archiveEnabled: v }),
      setArchivedTasks: (t) => set({ archivedTasks: t }),
```

`partialize`: `rolloverEnabled: s.rolloverEnabled,` → `archiveEnabled: s.archiveEnabled,`.

- [ ] **Step 4: App.tsx**

Деструктуризация из useStore: заменить `rolloverEnabled` на `archiveEnabled`, добавить `archivedTasks, setArchivedTasks` (в список из `useStore()`).

Заменить `const [rolloverCount, setRolloverCount] = useState(0);` на `const [archiveCount, setArchiveCount] = useState(0);` и `const rolloverRan = useRef(false);` на `const archiveRan = useRef(false);`.

Эффект авто-архива (объявлен ПЕРЕД reload-эффектом, чтобы reload не успел показать просроченные задачи в днях):

```tsx
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
```

`reload` — три пула:

```tsx
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
```

Баннер:

```tsx
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
```

- [ ] **Step 5: SettingsPanel.tsx**

Деструктуризация: `rolloverEnabled` → `archiveEnabled`, `setRolloverEnabled` → `setArchiveEnabled`. Строка настройки:

```tsx
              <span>Авто-архив просроченных задач</span>
```

Строка видимости: `["rolloverBanner", "Баннер «Перенесено задач»"],` → `["archiveBanner", "Баннер «Архивировано задач»"],`.

- [ ] **Step 6: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 7: Коммит**

```bash
git add src/api.ts src/api-browser-fallback.ts src/store.ts src/App.tsx src/components/SettingsPanel.tsx
git commit -m "feat: архив на фронте — API, фоллбек, пул, авто-архив, баннер"
```

---

### Task 3: Правая панель «Календарь + Когда-нибудь» + архив

**Files:**
- Create: `src/components/RightPanel.tsx`
- Create: `src/components/ArchivePanel.tsx`
- Modify: `src/components/SomedayColumn.tsx` (секция внутри панели)
- Modify: `src/views/WeekView.tsx` (панель вместо двух блоков; тулбар)
- Modify: `src/views/DayView.tsx` (панель + кнопка-тогл в заголовке дня)

**Interfaces:**
- Consumes: `store.visibility`, `store.archivedTasks` (Task 2), `api.restoreArchived` (Task 2), `MiniCalendar`, `DatePickerModal`, `SomedayColumn`, `somedayZoneId`.
- Produces: `RightPanel({ tasks: Task[], width?: number, onSelect: (d: Date) => void, onChange: () => void })`; `ArchivePanel({ tasks: Task[], onClose: () => void, onChange: () => void })`; SomedayColumn — секция без внешней рамки/ширины (пропсы не меняются).

- [ ] **Step 1: SomedayColumn → секция**

Заменить весь `src/components/SomedayColumn.tsx`:

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

/** Секция «Когда-нибудь» внутри правой панели (календарь сверху, эта секция
 *  под ним): задачи без привязки ко дню. Принимает задачи drag-ом; перенос
 *  в день — обычным drag на колонку дня. */
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
        display: "flex",
        flexDirection: "column",
        // Растёт до 45% высоты панели; без календаря (настройка выключена)
        // flex-grow растягивает секцию на всю высоту.
        flex: "1 1 auto",
        maxHeight: "45%",
        minHeight: 0,
        borderTop: `1px solid ${COLORS.cardBorder}`,
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

- [ ] **Step 2: Создать ArchivePanel.tsx**

```tsx
import { useState } from "react";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS } from "../theme";
import { Icon } from "./Icon";
import { DatePickerModal } from "./DatePickerModal";

interface Props {
  tasks: Task[];
  onClose: () => void;
  onChange: () => void;
}

/** Развёрнутый архив на всю правую панель: список скрытых задач и возврат
 *  на выбранную пользователем дату (DatePickerModal). */
export function ArchivePanel({ tasks, onClose, onChange }: Props) {
  // Задача, для которой открыт выбор даты возврата.
  const [restoring, setRestoring] = useState<Task | null>(null);

  const restore = async (t: Task, d: Date) => {
    await api.restoreArchived(t.id, d);
    setRestoring(null);
    onChange();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-2) var(--sp-3)",
          borderBottom: `1px solid ${COLORS.cardBorder}`,
        }}
      >
        <button className="icon-btn" onClick={onClose} title="Свернуть архив">
          <Icon name="chevronL" size={14} />
        </button>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: COLORS.accent }}>
          Архив
        </span>
        <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
          {tasks.length}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "var(--sp-2)" }}>
        {tasks.length === 0 && (
          <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
            Архив пуст.
          </p>
        )}
        {tasks.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              padding: "var(--sp-1) 0",
              borderBottom: `1px solid ${COLORS.cardBorder}`,
            }}
          >
            <input
              type="checkbox"
              checked={t.isDone}
              onChange={async () => {
                await api.upsertTask({ ...t, isDone: !t.isDone });
                onChange();
              }}
              title={t.isDone ? "Отметить невыполненной" : "Отметить выполненной"}
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "var(--fs-sm)",
                color: t.isDone ? COLORS.muted : COLORS.text,
                textDecoration: t.isDone ? "line-through" : "none",
              }}
            >
              {t.title || "(без названия)"}
            </span>
            <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, flexShrink: 0 }}>
              {fromEpochDay(t.date).toLocaleDateString("ru", { day: "numeric", month: "short" })}
            </span>
            <button
              className="chip-btn"
              onClick={() => setRestoring(t)}
              title="Вернуть на выбранную дату"
              style={{ fontSize: "var(--fs-2xs)", flexShrink: 0 }}
            >
              Вернуть…
            </button>
          </div>
        ))}
      </div>
      {restoring && (
        <DatePickerModal
          tasks={[]}
          onPick={(d) => restore(restoring, d)}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Создать RightPanel.tsx**

```tsx
import { useState } from "react";
import type { Task } from "../api";
import { MiniCalendar } from "./MiniCalendar";
import { SomedayColumn } from "./SomedayColumn";
import { ArchivePanel } from "./ArchivePanel";
import { COLORS } from "../theme";
import { useStore } from "../store";
import { Icon } from "./Icon";

interface Props {
  tasks: Task[];
  /** Ширина панели (DayView); undefined — тянется по родителю (WeekView). */
  width?: number;
  onSelect: (d: Date) => void;
  onChange: () => void;
}

/** Правая панель: мини-календарь сверху, «Когда-нибудь» под ним, полоска
 *  «Архив · N» внизу. Разворот архива занимает панель целиком. */
export function RightPanel({ tasks, width, onSelect, onChange }: Props) {
  const { visibility, archivedTasks } = useStore();
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <div
      style={{
        ...(width ? { width, flexShrink: 0 } : {}),
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        borderLeft: `1px solid ${COLORS.cardBorder}`,
      }}
    >
      {archiveOpen ? (
        <ArchivePanel
          tasks={archivedTasks}
          onClose={() => setArchiveOpen(false)}
          onChange={onChange}
        />
      ) : (
        <>
          {visibility.miniCalendar && (
            <div style={{ flex: 1, overflowY: "auto", padding: "var(--sp-4)", minWidth: 0 }}>
              <MiniCalendar tasks={tasks} large onSelect={onSelect} />
            </div>
          )}
          {visibility.someday && (
            <SomedayColumn tasks={tasks.filter((t) => t.someday)} onChange={onChange} />
          )}
          {archivedTasks.length > 0 && (
            <button
              onClick={() => setArchiveOpen(true)}
              title="Открыть архив"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                width: "100%",
                border: "none",
                borderTop: `1px solid ${COLORS.cardBorder}`,
                background: "transparent",
                padding: "var(--sp-2) var(--sp-3)",
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                color: COLORS.muted,
                cursor: "pointer",
              }}
            >
              <Icon name="note" size={14} />
              Архив · {archivedTasks.length}
            </button>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: WeekView.tsx**

Заменить `const showCal = showCalendar && visibility.miniCalendar;` на:

```tsx
  // Эффективная видимость панели: локальный переключатель И хотя бы одна
  // секция (календарь или «Когда-нибудь») включена настройками.
  const showPanel = showCalendar && (visibility.miniCalendar || visibility.someday);
```

Тулбар: `showCalendar={showCal}` → `showCalendar={showPanel}`, `calendarVisible={visibility.miniCalendar}` → `calendarVisible={visibility.miniCalendar || visibility.someday}` (кнопку переименовать: title «Скрыть календарь» → «Скрыть панель», «Показать календарь» → «Показать панель»).

Блок справа (строки 112-126) заменить на:

```tsx
        {/* Правая панель: календарь + «Когда-нибудь» + архив. Скрывается
            кнопкой тулбара, настройками видимости и в узком окне. */}
        {showPanel && !narrow && !calNarrow && (
          <RightCalendar
            width={calWidth}
            onResize={setCalWidth}
            tasks={tasks}
            onSelect={setSelectedDate}
            onChange={onChange}
          />
        )}
```

Убрать импорт `SomedayColumn`, добавить `RightPanel`. Функцию `RightCalendar` заменить (резервный resize-handle остаётся, содержимое — RightPanel):

```tsx
/** Правая панель недели: resize-handle + общий RightPanel (календарь,
 *  «Когда-нибудь», архив). */
function RightCalendar({
  width,
  onResize,
  tasks,
  onSelect,
  onChange,
}: {
  width: number;
  onResize: (w: number) => void;
  tasks: Task[];
  onSelect: (d: Date) => void;
  onChange: () => void;
}) {
  const draggingRef = useRef(false);

  // Resize мышью через drag-handle на левом краю панели.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      // Движение мыши влево увеличивает ширину (handle слева от панели).
      const next = Math.min(
        CAL_MAX,
        Math.max(CAL_MIN, startWidth + (startX - ev.clientX)),
      );
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

  // Сохраняем ширину при изменении.
  useEffect(() => {
    localStorage.setItem(CAL_KEY, String(width));
  }, [width]);

  return (
    <div
      style={{
        position: "relative",
        width,
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

- [ ] **Step 5: DayView.tsx**

Заменить правую часть: убрать блок `{visibility.someday && !narrow && (<SomedayColumn …/>)}` и блок `{visibility.miniCalendar && !calNarrow && (<div …><MiniCalendar …/></div>)}`, вместо них:

```tsx
        {/* Правая панель: календарь + «Когда-нибудь» + архив. Скрывается
            кнопкой в заголовке дня, настройками и в узком окне (calNarrow). */}
        {panelVisible && (
          <RightPanel
            tasks={tasks}
            width={280}
            onSelect={(d) => setSelectedDate(d)}
            onChange={onChange}
          />
        )}
```

В теле `DayView` добавить:

```tsx
  // Панель возможна, если включена хоть одна секция (календарь или
  // «Когда-нибудь»); локальный showPanel — кнопка в заголовке дня.
  const [showPanel, setShowPanel] = useState(true);
  const panelPossible = visibility.miniCalendar || visibility.someday;
  const panelVisible = showPanel && panelPossible && !calNarrow;
```

`DayTasksArea` — добавить пропсы `showPanel`, `onTogglePanel`, `panelPossible` и кнопку рядом с заголовком:

```tsx
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", margin: "0 0 var(--sp-6)" }}>
        <h2
          style={{
            fontSize: "var(--fs-xl)",
            fontWeight: 700,
            color: today ? COLORS.accent : COLORS.text,
            margin: 0,
            textTransform: "capitalize",
          }}
        >
          {day.toLocaleDateString("ru", {
            day: "numeric",
            month: "long",
            weekday: "long",
          })}
          {today && " ●"}
        </h2>
        {panelPossible && (
          <button
            className="chip-btn"
            onClick={onTogglePanel}
            title={showPanel ? "Скрыть панель" : "Показать панель"}
            style={{ flexShrink: 0 }}
          >
            {showPanel ? <Icon name="calendarHide" size={14} /> : <Icon name="calendar" size={14} />}
          </button>
        )}
      </div>
```

(Старый `<h2 style={{ … margin: "0 0 var(--sp-6)" … }}>` с `margin: 0` внутри обёртки убрать; добавить `import { Icon } from "../components/Icon";` и `import { RightPanel } from "../components/RightPanel";`, убрать импорты `MiniCalendar` и `SomedayColumn`.)

- [ ] **Step 6: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 7: Браузерная проверка (:1100, фоллбек)**

Неделя (сетка и список): «Когда-нибудь» под календарём, drag задача→секция и секция→день работают; кнопка тулбара скрывает/показывает всю панель. День: кнопка в заголовке скрывает/показывает панель. Настройки «Мини-календарь» и ««Когда-нибудь»» — секции внутри панели. Архив (если есть задачи): полоска внизу, разворот на всю панель, «Вернуть…» открывает календарь, выбор даты возвращает задачу.

- [ ] **Step 8: Коммит**

```bash
git add src/components/RightPanel.tsx src/components/ArchivePanel.tsx src/components/SomedayColumn.tsx src/views/WeekView.tsx src/views/DayView.tsx
git commit -m "feat: правая панель — «Когда-нибудь» под календарём, сворачивание, архив"
```

---

### Task 4: TaskCard — textarea с переносом во всех строках + заметки Enter/Shift+Enter

**Files:**
- Modify: `src/components/TaskCard.tsx`
- Modify: `src/views/DayView.tsx` (селектор createNext)
- Modify: `src/views/WeekViewVertical.tsx` (селектор createNext)

**Interfaces:**
- Consumes: существующие пропсы TaskCard (`task`, `onChange`, `onCreateNext`, `showTime`, `compact`), `onKeyDown` (Enter без Shift — сохранить+следующая).
- Produces: единый авто-растущий `<textarea data-task-id>` во всех режимах TaskCard (input-ветка удалена); заметки: Enter — сохранить и закрыть, Shift+Enter — перенос строки.

- [ ] **Step 1: Объединить input/textarea**

В `src/components/TaskCard.tsx`:

1. Удалить `const inputRef = useRef<HTMLInputElement>(null);` (остаётся только `textareaRef`).
2. `growCompactTitle` переименовать в `growTitle` (комментарий — «Авто-высота textarea: растёт по контенту, максимум ~4 строки (96px)»), тело не меняется.
3. Эффект авто-высоты — для всех режимов:

```tsx
  // При изменении текста/открытии — подгоняем высоту textarea.
  useEffect(() => {
    if (textareaRef.current) growTitle(textareaRef.current);
  }, [title, compact]);
```

4. Блок `{compact ? (<textarea …/>) : (<input …/>)}` заменить на единый textarea:

```tsx
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
          onInput={(e) => growTitle(e.currentTarget)}
          rows={1}
          data-task-id={task.id}
          title={title || undefined}
          style={{
            // flex-basis auto: flex-алгоритм учитывает высоту, заданную
            // growTitle (с flex-basis 0% строка не росла бы).
            flex: "1 1 auto",
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
```

(Контейнер вокруг остаётся: `flexDirection: compact ? "column" : "row"`, `alignItems: compact ? "flex-start" : "center"`; TimePicker — как был.)

- [ ] **Step 2: Заметки — Enter применяет, Shift+Enter — новая строка**

В `notes-panel` textarea `onKeyDown` заменить на:

```tsx
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing // игнорируем Enter во время IME-композиции
            ) {
              // «Применить»: сохранить и закрыть панель заметки.
              e.preventDefault();
              saveNotes();
              setNotesOpen(false);
            } else if (e.key === "Escape") {
              e.preventDefault();
              saveNotes();
              setNotesOpen(false);
            }
          }}
```

(Shift+Enter — стандартный перенос строки, не перехватывается.)

- [ ] **Step 3: Селекторы createNext — textarea**

`src/views/DayView.tsx`, в `createNext`:

```tsx
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLTextAreaElement>(
        "textarea[data-task-id]",
      );
      const empty = Array.from(inputs).find((i) => i.value === "");
      empty?.focus();
    });
```

`src/views/WeekViewVertical.tsx`, в `createNext`:

```tsx
      const empty = Array.from(
        container.querySelectorAll<HTMLTextAreaElement>("textarea[data-task-id]"),
      ).find((i) => i.value === "");
```

(DayColumn уже ищет `input[data-task-id], textarea[data-task-id]` — не трогаем.)

- [ ] **Step 4: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 5: Браузерная проверка (:1100)**

День: длинная задача переносится на 2-3 строки, строка растёт; Enter — сохраняет и создаёт следующую строку; Shift+Enter — перенос строки в тексте задачи; «Когда-нибудь» — то же; сетка недели — как раньше. Заметка: Enter — сохраняет и закрывает панель, Shift+Enter — перенос строки, Escape — сохраняет и закрывает.

- [ ] **Step 6: Коммит**

```bash
git add src/components/TaskCard.tsx src/views/DayView.tsx src/views/WeekViewVertical.tsx
git commit -m "feat: textarea с переносом во всех строках, заметки Enter/Shift+Enter"
```

---

### Task 5: Сортировка по времени убрана + период «Произвольный»

**Files:**
- Modify: `src/views/DayView.tsx` (сортировка)
- Modify: `src/views/WeekViewVertical.tsx` (сортировка)
- Modify: `src/views/SearchResults.tsx` (SortKey, сортировки, период custom, пропсы from/to)
- Modify: `src/components/SearchBar.tsx` (опции, строка «с/по», пропсы from/to)
- Modify: `src/App.tsx` (состояния периода и сбросы)

**Interfaces:**
- Consumes: `PeriodFilter` (Task 5 добавляет `"custom"`), `fromEpochDay` из `../api`.
- Produces: `SortKey = "dateAsc" | "dateDesc" | "alpha" | "alphaDesc" | "category"`; `SearchResults` получает `from: number | null`, `to: number | null` (epoch-day); `SearchBar` получает `from`, `to`, `onFrom(v: number | null)`, `onTo(v: number | null)`.

- [ ] **Step 1: DayView — сортировка только sortOrder**

Заменить `.sort(...)` в `dayTasks`:

```tsx
    .sort((a, b) => {
      // Порядок — только ручной (sortOrder); время не сортирует.
      return a.sortOrder - b.sortOrder;
    });
```

- [ ] **Step 2: WeekViewVertical — сортировка только sortOrder**

Заменить `.sort(...)` в `tasksForDay`:

```tsx
      .sort((a, b) => {
        // Порядок — только ручной (sortOrder); время не сортирует.
        return a.sortOrder - b.sortOrder;
      });
```

- [ ] **Step 3: SearchResults — типы, сортировки, период custom**

Тип:

```ts
/** Ключ сортировки результатов поиска. */
export type SortKey = "dateAsc" | "dateDesc" | "alpha" | "alphaDesc" | "category";
```

Props — добавить `from: number | null; to: number | null;` и деструктуризацию.

В цепочке фильтров после `if (period === "month") {...}` добавить:

```tsx
      if (period === "custom") {
        // Произвольный диапазон: epoch-day задачи сравниваем напрямую;
        // незаполненный край — без ограничения.
        if (from != null && t.date < from) return false;
        if (to != null && t.date > to) return false;
        return true;
      }
```

Сортировку заменить на:

```tsx
    .sort((a, b) => {
      const ad = a.date, bd = b.date;
      switch (sort) {
        case "dateDesc": return bd - ad || a.sortOrder - b.sortOrder;
        case "alpha": return a.title.localeCompare(b.title, "ru", { sensitivity: "base" });
        case "alphaDesc": return b.title.localeCompare(a.title, "ru", { sensitivity: "base" });
        case "category": {
          const an = colorName(a.colorSetId), bn = colorName(b.colorSetId);
          return an.localeCompare(bn, "ru") || ad - bd || a.sortOrder - b.sortOrder;
        }
        default: return ad - bd || a.sortOrder - b.sortOrder;
      }
    });
```

- [ ] **Step 4: SearchBar — «Произвольный…» и строка «с/по»**

Props — добавить `from: number | null; to: number | null; onFrom: (v: number | null) => void; onTo: (v: number | null) => void;` и импорт `fromEpochDay` из `../api`.

Хелперы конверсии (в конец файла):

```tsx
/** epoch-day → ISO-строка YYYY-MM-DD (для <input type="date">). */
const toISODate = (ed: number): string => {
  const d = fromEpochDay(ed);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** ISO-строка YYYY-MM-DD → epoch-day. */
const fromISODate = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};
```

Опции периода:

```tsx
        <FilterSelect label="Период" value={period} options={[["all", "Все"], ["today", "Сегодня"], ["overdue", "Просроч."], ["7days", "7 дней"], ["month", "Месяц"], ["custom", "Произвольный…"]] as const}
          open={openKey === "period"} onToggle={() => toggle("period")} onChange={onPeriod} />
```

Опции сортировки (без времени):

```tsx
        <FilterSelect label="Сортировка" value={sort} options={[["dateAsc", "По дате ↑"], ["dateDesc", "По дате ↓"], ["alpha", "А-Я"], ["alphaDesc", "Я-А"], ["category", "Категория"]] as const}
          open={openKey === "sort"} onToggle={() => toggle("sort")} onChange={onSort} />
```

Строка диапазона — после ряда фильтров (внутри колонки панели):

```tsx
      {period === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-xs)", color: COLORS.muted }}>
          <span>с</span>
          <input
            type="date"
            value={from ? toISODate(from) : ""}
            onChange={(e) => onFrom(e.target.value ? fromISODate(e.target.value) : null)}
            style={{ border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-sm)", padding: "2px 6px", background: "transparent", color: COLORS.text, outline: "none" }}
          />
          <span>по</span>
          <input
            type="date"
            value={to ? toISODate(to) : ""}
            onChange={(e) => onTo(e.target.value ? fromISODate(e.target.value) : null)}
            style={{ border: `1px solid ${COLORS.cardBorder}`, borderRadius: "var(--radius-sm)", padding: "2px 6px", background: "transparent", color: COLORS.text, outline: "none" }}
          />
        </div>
      )}
```

- [ ] **Step 5: App.tsx — состояния периода**

После `const [searchSort, setSearchSort] = useState<SortKey>("dateAsc");`:

```tsx
  // Период «Произвольный»: диапазон с/по (epoch-day; null = край не задан).
  const [searchPeriodFrom, setSearchPeriodFrom] = useState<number | null>(null);
  const [searchPeriodTo, setSearchPeriodTo] = useState<number | null>(null);
```

Передать в `SearchBar`: `from={searchPeriodFrom} to={searchPeriodTo} onFrom={setSearchPeriodFrom} onTo={setSearchPeriodTo}`; в `SearchResults`: `from={searchPeriodFrom} to={searchPeriodTo}`.

Во всех четырёх сбросах (эффект `visibility.search`, `onToggleSearch`, `onClose`, `onResetFilters`) добавить:

```tsx
      setSearchPeriodFrom(null);
      setSearchPeriodTo(null);
```

- [ ] **Step 6: Проверить типы**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npx tsc --noEmit`
Expected: OK, 0 ошибок.

- [ ] **Step 7: Браузерная проверка (:1100)**

Порядок задач в дне не зависит от времени (задача с более поздним временем стоит выше при более раннем sortOrder); в поиске нет «По времени»; «Период: Произвольный…» — строка «с/по», фильтрует диапазон, пустой край не ограничивает; «Сбросить фильтры» и закрытие поиска очищают даты.

- [ ] **Step 8: Коммит**

```bash
git add src/views/DayView.tsx src/views/WeekViewVertical.tsx src/views/SearchResults.tsx src/components/SearchBar.tsx src/App.tsx
git commit -m "feat: без сортировки по времени; период «Произвольный» в поиске"
```

---

### Task 6: Финальная верификация + доки

**Files:** нет кодовых правок — проверки и коммит доков.

- [ ] **Step 1: Rust-тесты и компиляция**

Run: `cd src-tauri && cargo test --lib && cargo check`
Expected: 6 тестов PASS, check чистый.

- [ ] **Step 2: Полная сборка фронта**

Run: `cd /Users/ivolga/My\ Project/ZK_Project/todo && npm run build`
Expected: tsc + vite build без ошибок.

- [ ] **Step 3: Сквозная браузерная проверка (:1100)**

Панель (календарь + «Когда-нибудь» + полоска архива) в неделе (сетка и список) и дне; сворачивание; перенос текста; заметки Enter/Shift+Enter; порядок без времени; период «Произвольный»; архив: авто-архив при старте (баннер), разворот, «Вернуть…» с выбором даты, задача на выбранной дате; drag «Когда-нибудь» ⇄ день; поиск; экспорт/импорт полей archived (визуально — фоллбек не имеет экспорта; проверяется в Tauri).

- [ ] **Step 4: Коммит доков**

```bash
git add docs/superpowers/specs/2026-08-03-panel-archive-design.md docs/superpowers/plans/2026-08-03-panel-archive.md
git commit -m "docs: спека и план «Панель + архив»"
```
