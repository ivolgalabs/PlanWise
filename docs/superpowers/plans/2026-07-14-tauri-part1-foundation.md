# Tauri Часть 1: Скелет + Rust-ядро + tweek-style UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Поднять Tauri v2 + React/TS приложение «с нуля», реализовать Rust-ядро
с локальной SQLite (rusqlite) и построить tweek-style UI: inline-ввод задач в
каждый день, виды День/Неделя/Месяц, мини-календарь, настройки, выбор даты.

**Architecture:** Tauri v2. Frontend = React + TypeScript + Vite. Backend =
Rust с rusqlite. Frontend общается с Rust только через Tauri IPC-команды
(`invoke`). State на frontend = Zustand (тонкий, без boilerplate). Drag-and-drop
= @dnd-kit/core.

**Tech Stack:** Tauri 2.x, React 19, TypeScript, Vite, Zustand, @dnd-kit/core,
rusqlite, refinery (миграции), uuid, date-fns.

**Платформа сборки:** macOS (через CLT, без полного Xcode).

---

## Файловая структура (что создаётся)

```
todo/
├── src-tauri/                    # Rust backend (Tauri)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/
│   ├── migrations/               # SQL-миграции (refinery)
│   │   └── V1__initial.sql
│   └── src/
│       ├── main.rs               # точка входа Tauri, регистрация команд
│       ├── db.rs                 # инициализация SQLite + пул
│       ├── models.rs             # Rust-структуры Task, ColorSet (serde)
│       └── commands.rs           # Tauri-команды: get_tasks, upsert_task, ...
├── src/                          # React frontend
│   ├── main.tsx                  # точка входа React
│   ├── App.tsx                   # корневой компонент + роутинг видов
│   ├── api.ts                    # обёртка над Tauri invoke
│   ├── store.ts                  # Zustand store (selectedDate, view, tasks)
│   ├── date.ts                   # утилиты дат (week, month, isSameDay)
│   ├── theme.ts                  # палитра + CSS-переменные
│   ├── components/
│   │   ├── TaskCard.tsx          # карточка задачи (inline edit, цвет, done)
│   │   ├── DayColumn.tsx         # колонка дня с inline-полем ввода
│   │   ├── MiniCalendar.tsx      # мини-календарь с занятостью
│   │   ├── MonthGrid.tsx         # сетка месяца (вид «Месяц»)
│   │   ├── ViewSwitcher.tsx      # сегментированный День/Неделя/Месяц
│   │   ├── TopBar.tsx            # шапка: навигация, switcher, settings
│   │   ├── SettingsPanel.tsx     # экран настроек (тема, неделя с Пн/Вс)
│   │   └── DatePickerModal.tsx   # модалка выбора даты (прыжок)
│   └── views/
│       ├── DayView.tsx
│       ├── WeekView.tsx          # горизонтальный 7-колонок + dnd-kit
│       ├── WeekViewVertical.tsx  # вертикальный список (узкий экран)
│       └── MonthView.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

Принцип: каждый файл — одна ответственность. Frontend тонкий (state + IPC),
Rust владеет данными.

---

## Task 1: Bootstrap Tauri v2 + React проекта

**Files:**
- Create: весь скелет через `cargo tauri init` / `npm create tauri-app`

- [ ] **Step 1: Создать Tauri-приложение через официальный шаблон**

Из корня проекта (`/Users/ivolga/My Project/ZK_Project/todo`):
```bash
# Tauri v2 + React + TypeScript, в текущую директорию
npm create tauri-app@latest -- --template react-ts --manager npm --name daily-planner --identifier com.zkproject.dailyplanner
```
Если шаблон не поддерживает `.` напрямую, создать во временную папку и перенести:
```bash
cd /tmp && npm create tauri-app@latest -- --template react-ts --manager npm --name daily-planner --identifier com.zkproject.dailyplanner
# затем перенести содержимое в проект, не затирая docs/ legacy/ .git/
```

Expected: созданы `src/`, `src-tauri/`, `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`.

- [ ] **Step 2: Установить frontend-зависимости**

```bash
cd "/Users/ivolga/My Project/ZK_Project/todo"
npm install
npm install zustand @dnd-kit/core @dnd-kit/sortable date-fns
```
Expected: `added N packages`.

- [ ] **Step 3: Smoke-запуск dev-режима**

```bash
npm run tauri dev
```
Expected: открывается окно Tauri с дефолтным React-экраном «Welcome». Закрыть окно (Ctrl-C).

- [ ] **Step 4: Закоммитить скелет**

```bash
cd "/Users/ivolga/My Project/ZK_Project/todo"
# обновить .gitignore для node_modules
git add -A
git commit -m "chore: bootstrap Tauri v2 + React + TypeScript"
```

---

## Task 2: Rust-модели и SQLite-миграции

**Files:**
- Create: `src-tauri/migrations/V1__initial.sql`
- Create: `src-tauri/src/models.rs`
- Modify: `src-tauri/Cargo.toml` (добавить rusqlite, refinery, serde, uuid, chrono)

- [ ] **Step 1: Добавить Rust-зависимости**

В `src-tauri/Cargo.toml`, секция `[dependencies]`, добавить:
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
refinery = { version = "0.8", features = ["rusqlite"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: Создать SQL-миграцию**

Создать `src-tauri/migrations/V1__initial.sql`:
```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date INTEGER NOT NULL,           -- epoch-day
    is_done INTEGER NOT NULL DEFAULT 0,
    color_set_id TEXT,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,     -- epoch-ms
    updated_at INTEGER NOT NULL,     -- epoch-ms
    device_id TEXT NOT NULL
);
CREATE INDEX idx_tasks_date ON tasks(date);

CREATE TABLE color_sets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color INTEGER NOT NULL,          -- ARGB
    sort_order REAL NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Дефолтные сеты цветов
INSERT INTO color_sets (id, name, color, sort_order) VALUES
    ('cs-none', 'Без категории', 4280860498, 0.0),
    ('cs-work', 'Работа', 4289342844, 1.0),
    ('cs-personal', 'Личное', 4284238148, 2.0),
    ('cs-sport', 'Спорт', 4285595260, 3.0);
```
(цвета — ARGB-int представление 0xFF...: бежевый F0ECE2, терракотовый C9A87C, бирюзовый 7EB8C4, коралловый E8A87C)

- [ ] **Step 3: Создать Rust-модели**

Создать `src-tauri/src/models.rs`:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub date: i64,        // epoch-day
    pub is_done: bool,
    pub color_set_id: Option<String>,
    pub sort_order: f64,
    pub created_at: i64,  // epoch-ms
    pub updated_at: i64,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSet {
    pub id: String,
    pub name: String,
    pub color: i64,       // ARGB
    pub sort_order: f64,
}
```

- [ ] **Step 4: Проверить, что Rust-код компилируется**

Run: `cd src-tauri && cargo check`
Expected: `Finished` без ошибок.

- [ ] **Step 5: Закоммитить**

```bash
git add src-tauri/
git commit -m "feat(rust): add Task/ColorSet models and V1 SQLite migration"
```

---

## Task 3: Rust-ядро — инициализация БД + Tauri-команды

**Files:**
- Create: `src-tauri/src/db.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Реализовать db.rs (инициализация + миграции)**

Создать `src-tauri/src/db.rs`:
```rust
use rusqlite::Connection;
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Db(pub Mutex<Connection>);

pub fn init(app: &AppHandle) -> std::sync::Mutex<rusqlite::Connection> {
    let app_dir = app.path().app_data_dir().expect("no app data dir");
    fs::create_dir_all(&app_dir).ok();
    let db_path = app_dir.join("daily_planner.sqlite");
    let mut conn = Connection::open(db_path).expect("open db");

    // Миграции через refinery
    use refinery::embed_migrations;
    embed_migrations!("migrations");
    migrations::runner().run(&mut conn).expect("run migrations");

    Mutex::new(conn)
}
```

- [ ] **Step 2: Реализовать commands.rs**

Создать `src-tauri/src/commands.rs`:
```rust
use crate::db::Db;
use crate::models::{ColorSet, Task};
use chrono::{DateTime, Datelike, NaiveDate, Timelike, Utc};
use tauri::State;
use uuid::Uuid;

fn epoch_day(date: NaiveDate) -> i64 {
    (date.and_hms_opt(0, 0, 0).unwrap()
        - chrono::NaiveDate::from_ymd_opt(1970, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap())
    .num_days() as i64
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

#[tauri::command]
pub fn get_tasks(state: State<Db>, start_day: i64, end_day: i64) -> Vec<Task> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id FROM tasks WHERE date BETWEEN ?1 AND ?2 ORDER BY sort_order ASC")
        .unwrap();
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
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

#[tauri::command]
pub fn upsert_task(state: State<Db>, mut task: Task) -> Task {
    let conn = state.0.lock().unwrap();
    if task.id.is_empty() {
        task.id = Uuid::new_v4().to_string();
    }
    if task.created_at == 0 {
        task.created_at = now_ms();
    }
    task.updated_at = now_ms();
    conn.execute(
        "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, date=excluded.date, is_done=excluded.is_done,
           color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
           updated_at=excluded.updated_at, device_id=excluded.device_id",
        rusqlite::params![
            task.id, task.title, task.date, task.is_done as i64,
            task.color_set_id, task.sort_order, task.created_at, task.updated_at,
            task.device_id,
        ],
    )
    .unwrap();
    task
}

#[tauri::command]
pub fn delete_task(state: State<Db>, id: String) {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id]).unwrap();
}

#[tauri::command]
pub fn move_task(state: State<Db>, id: String, new_date: i64) {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "UPDATE tasks SET date = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_date, now_ms(), id],
    )
    .unwrap();
}

#[tauri::command]
pub fn get_color_sets(state: State<Db>) -> Vec<ColorSet> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, color, sort_order FROM color_sets ORDER BY sort_order ASC")
        .unwrap();
    stmt.query_map([], |row| {
        Ok(ColorSet {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            sort_order: row.get(3)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}
```

- [ ] **Step 3: Связать всё в main.rs**

Заменить `src-tauri/src/main.rs`:
```rust
mod commands;
mod db;
mod models;

use db::Db;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::init(&app.handle());
            app.manage(Db(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_tasks,
            commands::upsert_task,
            commands::delete_task,
            commands::move_task,
            commands::get_color_sets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Проверить компиляцию**

Run: `cd src-tauri && cargo check`
Expected: `Finished`. Если ругается на `tauri_plugin_opener` — убрать строку `.plugin(...)` (это плагин по умолчанию, может не быть).

- [ ] **Step 5: Закоммитить**

```bash
git add src-tauri/
git commit -m "feat(rust): db init + Tauri commands (get_tasks, upsert, move, delete)"
```

---

## Task 4: Frontend-фундамент (api, store, date, theme)

**Files:**
- Create: `src/api.ts`
- Create: `src/store.ts`
- Create: `src/date.ts`
- Create: `src/theme.ts`

- [ ] **Step 1: api.ts — обёртка над Tauri invoke**

```ts
import { invoke } from '@tauri-apps/api/core';

export interface Task {
  id: string;
  title: string;
  date: number;        // epoch-day
  isDone: boolean;
  colorSetId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
}

export interface ColorSet {
  id: string;
  name: string;
  color: number;
  sortOrder: number;
}

// epoch-day helpers (должны совпадать с Rust)
export const toEpochDay = (d: Date): number => {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(utc / 86_400_000);
};
export const fromEpochDay = (n: number): Date => {
  const ms = n * 86_400_000;
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const api = {
  getTasks: (start: Date, end: Date) =>
    invoke<Task[]>('get_tasks', { startDay: toEpochDay(start), endDay: toEpochDay(end) }),
  upsertTask: (task: Partial<Task> & { title: string; date: number }) =>
    invoke<Task>('upsert_task', {
      task: {
        id: task.id ?? '',
        title: task.title,
        date: task.date,
        isDone: task.isDone ?? false,
        colorSetId: task.colorSetId ?? null,
        sortOrder: task.sortOrder ?? Date.now(),
        createdAt: task.createdAt ?? 0,
        updatedAt: 0,
        deviceId: task.deviceId ?? '',
      },
    }),
  deleteTask: (id: string) => invoke<void>('delete_task', { id }),
  moveTask: (id: string, newDate: Date) =>
    invoke<void>('move_task', { id, newDate: toEpochDay(newDate) }),
  getColorSets: () => invoke<ColorSet[]>('get_color_sets'),
};
```

- [ ] **Step 2: date.ts — утилиты дат**

```ts
export const startOfWeek = (d: Date, mondayFirst = true): Date => {
  const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = mondayFirst ? mid.getDay() - 1 : mid.getDay() % 7;
  // поправка:.getDay() возвращает 0=Sun..6=Sat; для Пн-начала
  const realOffset = mondayFirst ? (mid.getDay() + 6) % 7 : mid.getDay();
  mid.setDate(mid.getDate() - realOffset);
  return mid;
};

export const weekDays = (d: Date, mondayFirst = true): Date[] => {
  const start = startOfWeek(d, mondayFirst);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
};

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isToday = (d: Date): boolean => isSameDay(d, new Date());
```

- [ ] **Step 3: store.ts — Zustand**

```ts
import { create } from 'zustand';
import { Task } from './api';

export type ViewKind = 'day' | 'week' | 'month';

interface PlannerState {
  selectedDate: Date;
  view: ViewKind;
  tasks: Task[];
  mondayFirst: boolean;
  setSelectedDate: (d: Date) => void;
  setView: (v: ViewKind) => void;
  setTasks: (t: Task[]) => void;
  toggleMondayFirst: () => void;
}

export const useStore = create<PlannerState>((set) => ({
  selectedDate: new Date(),
  view: 'week',
  tasks: [],
  mondayFirst: true,
  setSelectedDate: (d) => set({ selectedDate: d }),
  setView: (v) => set({ view: v }),
  setTasks: (t) => set({ tasks: t }),
  toggleMondayFirst: () => set((s) => ({ mondayFirst: !s.mondayFirst })),
}));
```

- [ ] **Step 4: theme.ts — палитра как CSS-переменные**

```ts
export const COLORS = {
  paper: '#FAF7F0',
  card: '#FFFFFF',
  cardBorder: '#E8E2D4',
  muted: '#9A8F7A',
  text: '#5A5240',
  accent: '#C9A87C',
  setNone: '#F0ECE2',
  setWork: '#C9A87C',
  setPersonal: '#7EB8C4',
  setSport: '#E8A87C',
};

export const colorSetHex = (id: string | null): string => {
  switch (id) {
    case 'cs-work': return COLORS.setWork;
    case 'cs-personal': return COLORS.setPersonal;
    case 'cs-sport': return COLORS.setSport;
    default: return COLORS.setNone;
  }
};

// ARGB-int (из Rust) -> #RRGGBB hex (для UI)
export const argbToHex = (argb: number): string => {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
};
```

- [ ] **Step 5: Проверить TS-компиляцию**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 6: Закоммитить**

```bash
git add src/
git commit -m "feat(frontend): api wrapper, date utils, zustand store, theme"
```

---

## Task 5: tweek-style UI — inline TaskCard + DayColumn

**Files:**
- Create: `src/components/TaskCard.tsx`
- Create: `src/components/DayColumn.tsx`

- [ ] **Step 1: TaskCard — inline-редактирование + цвет + done**

```tsx
import { useState } from 'react';
import { Task, api } from '../api';
import { COLORS, colorSetHex } from '../theme';

interface Props {
  task: Task;
  onChange: () => void;  // триггер reload задач после изменения
}

export function TaskCard({ task, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [colorMenu, setColorMenu] = useState(false);

  const save = async () => {
    if (title.trim() && title !== task.title) {
      await api.upsertTask({ ...task, title: title.trim() });
      onChange();
    }
    setEditing(false);
  };

  const toggleDone = async () => {
    await api.upsertTask({ ...task, isDone: !task.isDone });
    onChange();
  };

  const setColor = async (id: string | null) => {
    await api.upsertTask({ ...task, colorSetId: id });
    setColorMenu(false);
    onChange();
  };

  const del = async () => {
    await api.deleteTask(task.id);
    onChange();
  };

  const bg = task.isDone ? COLORS.setNone : colorSetHex(task.colorSetId);

  return (
    <div style={{ background: bg, position: 'relative' }} className="task-card">
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px' }}>
        <input type="checkbox" checked={task.isDone} onChange={toggleDone} style={{ marginRight: 6 }} />
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') { setTitle(task.title); setEditing(false); }
            }}
            style={{ flex: 1, fontSize: 13, border: 'none', background: 'transparent' }}
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            style={{
              flex: 1, fontSize: 13, color: task.isDone ? COLORS.muted : COLORS.text,
              textDecoration: task.isDone ? 'line-through' : 'none',
              cursor: 'pointer',
            }}
          >
            {task.title}
          </span>
        )}
        <button onClick={() => setColorMenu((v) => !v)} className="chip-btn" title="Цвет">●</button>
      </div>
      {colorMenu && (
        <div className="color-menu">
          <button onClick={() => setColor(null)} style={{ background: COLORS.setNone }} />
          <button onClick={() => setColor('cs-work')} style={{ background: COLORS.setWork }} />
          <button onClick={() => setColor('cs-personal')} style={{ background: COLORS.setPersonal }} />
          <button onClick={() => setColor('cs-sport')} style={{ background: COLORS.setSport }} />
          <button onClick={del} title="Удалить" className="del-btn">✕</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: DayColumn — заголовок + задачи + inline-поле ввода**

```tsx
import { useState } from 'react';
import { Task, api } from '../api';
import { isToday } from '../date';
import { TaskCard } from './TaskCard';
import { COLORS } from '../theme';

interface Props {
  day: Date;
  tasks: Task[];
  onChange: () => void;
}

export function DayColumn({ day, tasks, onChange }: Props) {
  const [newTitle, setNewTitle] = useState('');
  const today = isToday(day);
  const weekday = day.toLocaleDateString('ru', { weekday: 'short' });
  const dayNum = day.getDate();

  const addTask = async () => {
    const t = newTitle.trim();
    if (!t) return;
    const { toEpochDayNotNeeded } = { toEpochDayNotNeeded: null }; // date в epoch-day
    // вычисляем epoch-day локально
    const epochDay = Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000);
    await api.upsertTask({ title: t, date: epochDay });
    setNewTitle('');
    onChange();
  };

  return (
    <div
      className="day-column"
      style={{
        background: COLORS.card,
        border: `1px solid ${today ? COLORS.accent : COLORS.cardBorder}`,
        borderWidth: today ? 2 : 1,
      }}
    >
      <div className="day-header" style={{ padding: '4px 6px' }}>
        <span style={{ fontWeight: 600, fontSize: 11, color: today ? COLORS.accent : COLORS.muted, textTransform: 'uppercase' }}>
          {weekday} {today && '●'}
        </span>
        <span style={{ float: 'right', fontSize: 10, color: today ? COLORS.accent : COLORS.muted }}>{dayNum}</span>
      </div>
      <div className="day-tasks" style={{ padding: 4, minHeight: 40 }}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onChange={onChange} />
        ))}
      </div>
      <input
        className="inline-input"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
        placeholder="+ добавить"
        style={{ width: '100%', border: 'none', borderTop: `1px solid ${COLORS.cardBorder}`, padding: '4px 6px', fontSize: 12, background: 'transparent' }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Проверить TS-компиляцию**

Run: `npx tsc --noEmit`
Expected: без ошибок (если ругается на неиспользуемые переменные — убрать).

- [ ] **Step 4: Закоммитить**

```bash
git add src/components/
git commit -m "feat(ui): tweek-style TaskCard (inline edit) + DayColumn (inline input)"
```

---

## Task 6: Виды Day/Week/Month + MiniCalendar + TopBar + Settings

**Files:**
- Create: `src/views/DayView.tsx`
- Create: `src/views/WeekView.tsx`
- Create: `src/views/WeekViewVertical.tsx`
- Create: `src/views/MonthView.tsx`
- Create: `src/components/MiniCalendar.tsx`
- Create: `src/components/ViewSwitcher.tsx`
- Create: `src/components/TopBar.tsx`
- Create: `src/components/SettingsPanel.tsx`
- Create: `src/components/DatePickerModal.tsx`

- [ ] **Step 1: DayView**

```tsx
import { Task } from '../api';
import { TaskCard } from '../components/TaskCard';

export function DayView({ day, tasks, onChange }: { day: Date; tasks: Task[]; onChange: () => void }) {
  const dayTasks = tasks.filter((t) => {
    const d = new Date(t.date * 86_400_000);
    return d.getUTCFullYear() === day.getFullYear() && d.getUTCMonth() === day.getMonth() && d.getUTCDate() === day.getDate();
  });
  return (
    <div style={{ padding: 12, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600 }}>
        {day.toLocaleDateString('ru', { day: 'numeric', month: 'long', weekday: 'long' })}
      </h2>
      <div style={{ marginTop: 12 }}>
        {dayTasks.length === 0 && <p style={{ color: '#9A8F7A' }}>Нет задач</p>}
        {dayTasks.map((t) => (
          <div key={t.id} style={{ marginBottom: 6 }}>
            <TaskCard task={t} onChange={onChange} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: WeekView (горизонтальный с @dnd-kit)**

```tsx
import { useState } from 'react';
import { Task, api } from '../api';
import { weekDays } from '../date';
import { DayColumn } from '../components/DayColumn';
import { COLORS } from '../theme';
import { useStore } from '../store';

export function WeekView({ tasks, onChange }: { tasks: Task[]; onChange: () => void }) {
  const { selectedDate, mondayFirst } = useStore();
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const days = weekDays(selectedDate, mondayFirst);

  const tasksForDay = (d: Date) =>
    tasks.filter((t) => {
      const td = new Date(t.date * 86_400_000);
      return td.getUTCFullYear() === d.getFullYear() && td.getUTCMonth() === d.getMonth() && td.getUTCDate() === d.getDate();
    });

  const onDrop = async (day: Date) => {
    if (dragTask) {
      const td = new Date(dragTask.date * 86_400_000);
      const same = td.getUTCFullYear() === day.getFullYear() && td.getUTCMonth() === day.getMonth() && td.getUTCDate() === day.getDate();
      if (!same) {
        await api.moveTask(dragTask.id, day);
        onChange();
      }
    }
    setDragTask(null);
    setHoverDay(null);
  };

  return (
    <div style={{ display: 'flex', gap: 4, padding: 4, height: '100%' }}>
      {days.map((d) => (
        <div
          key={d.toISOString()}
          onDragOver={(e) => { e.preventDefault(); setHoverDay(d); }}
          onDrop={() => onDrop(d)}
          style={{
            flex: 1,
            background: hoverDay && hoverDay.toDateString() === d.toDateString() ? COLORS.accent + '14' : 'transparent',
          }}
        >
          <DayColumn day={d} tasks={tasksForDay(d).map((t) => ({ ...t, _drag: setDragTask }))} onChange={onChange} />
        </div>
      ))}
    </div>
  );
}
```
(Примечание: для простоты использован нативный HTML5 drag; `_drag` — расширение для передачи setter'а. Можно заменить на @dnd-kit в следующей итерации.)

- [ ] **Step 3: WeekViewVertical, MonthView, MiniCalendar, ViewSwitcher, TopBar, SettingsPanel, DatePickerModal**

Создать остальные компоненты по аналогии (см. спеку раздел 7). Они менее сложны:
- `WeekViewVertical`: `weekDays` вертикально, `DayColumn` подряд.
- `MonthView`: сетка 7×N с превью задач (как в legacy Flutter `MonthGrid`).
- `MiniCalendar`: месяц с точками занятости.
- `ViewSwitcher`: 3 кнопки День/Неделя/Месяц.
- `TopBar`: навигация ‹ › + switcher + кнопка настроек.
- `SettingsPanel`: тема, mondayFirst toggle.
- `DatePickerModal`: выбор произвольной даты.

- [ ] **Step 4: Собрать в App.tsx + глобальный CSS**

В `src/App.tsx` связать всё: `useEffect` для загрузки задач при смене `selectedDate`/`view`, рендер TopBar + текущий view + (опционально) MiniCalendar sidebar.

Добавить базовый CSS в `src/style.css` (tweek-paper background, шрифты, padding).

- [ ] **Step 5: Проверить TS-компиляцию**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Закоммитить**

```bash
git add src/
git commit -m "feat(ui): Day/Week/Month views, mini calendar, top bar, settings"
```

---

## Task 7: Финальная проверка + запуск

- [ ] **Step 1: TS-компиляция**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 2: Rust-компиляция**

Run: `cd src-tauri && cargo check`
Expected: `Finished`.

- [ ] **Step 3: Dev-запуск**

Run: `npm run tauri dev`
Expected: окно Tauri открывается с рабочим планировщиком.

- [ ] **Step 4: Smoke end-to-end**

В окне: напечатать задачу в поле дня → Enter → задача появилась. Двойной клик → inline-редактирование. Кнопка ● → выбор цвета. Переключатель День/Неделя/Месяц. Мини-календарь → тап по дню. Drag задачи в соседний день (desktop).

- [ ] **Step 5: Закоммитить финал**

```bash
git add -A
git commit -m "feat: Tauri Phase 1 Part 1 complete — tweek-style planner"
```
