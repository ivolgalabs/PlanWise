use crate::db::Db;
use crate::models::{ColorSet, Subtask, Task};
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

#[tauri::command]
pub fn get_tasks(state: State<'_, Db>, start_day: i64, end_day: i64) -> Vec<Task> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes
             FROM tasks WHERE date BETWEEN ?1 AND ?2 ORDER BY time_minutes IS NULL, time_minutes ASC, sort_order ASC",
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
        })
    })
    .expect("query get_tasks")
    .filter_map(|r| r.ok())
    .collect()
}

#[tauri::command]
pub fn upsert_task(state: State<'_, Db>, mut task: Task) -> Task {
    let conn = state.0.lock().unwrap();
    if task.id.is_empty() {
        task.id = Uuid::new_v4().to_string();
    }
    if task.created_at == 0 {
        task.created_at = now_ms();
    }
    task.updated_at = now_ms();
    conn.execute(
        "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, date=excluded.date, is_done=excluded.is_done,
           color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
           updated_at=excluded.updated_at, device_id=excluded.device_id,
           time_minutes=excluded.time_minutes",
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
        ],
    )
    .expect("upsert_task execute");
    task
}

#[tauri::command]
pub fn delete_task(state: State<'_, Db>, id: String) {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])
        .expect("delete_task");
}

#[tauri::command]
pub fn move_task(state: State<'_, Db>, id: String, new_date: i64) {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "UPDATE tasks SET date = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_date, now_ms(), id],
    )
    .expect("move_task");
}

#[tauri::command]
pub fn get_color_sets(state: State<'_, Db>) -> Vec<ColorSet> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, color, sort_order FROM color_sets ORDER BY sort_order ASC")
        .expect("prepare get_color_sets");
    stmt.query_map([], |row| {
        Ok(ColorSet {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            sort_order: row.get(3)?,
        })
    })
    .expect("query get_color_sets")
    .filter_map(|r| r.ok())
    .collect()
}

/// Создать/обновить категорию (цвет-сет). Пустой id — новая категория.
#[tauri::command]
pub fn upsert_color_set(state: State<'_, Db>, mut set: ColorSet) -> ColorSet {
    let conn = state.0.lock().unwrap();
    if set.id.is_empty() {
        set.id = Uuid::new_v4().to_string();
    }
    conn.execute(
        "INSERT INTO color_sets (id, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color,
           sort_order=excluded.sort_order",
        rusqlite::params![set.id, set.name, set.color, set.sort_order],
    )
    .expect("upsert_color_set execute");
    set
}

/// Удалить категорию. Задачи с ней становятся «без категории» (NULL).
#[tauri::command]
pub fn delete_color_set(state: State<'_, Db>, id: String) {
    let conn = state.0.lock().unwrap();
    // Служебный сет «Без категории» (cs-none) удалять нельзя — на него
    // завязан NULL-смысл color_set_id.
    if id == "cs-none" {
        return;
    }
    conn.execute(
        "UPDATE tasks SET color_set_id = NULL, updated_at = ?1 WHERE color_set_id = ?2",
        rusqlite::params![now_ms(), id],
    )
    .expect("delete_color_set tasks");
    conn.execute("DELETE FROM color_sets WHERE id = ?1", [id])
        .expect("delete_color_set");
}

/// Перенос всех невыполненных задач строго ДО todayEpochDay на сегодня.
/// Возвращает количество перенесённых задач (для плашки в UI).
#[tauri::command]
pub fn rollover_overdue(state: State<'_, Db>, today_epoch_day: i64) -> i64 {
    let conn = state.0.lock().unwrap();
    // Сначала считаем, сколько строк затронем.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE is_done = 0 AND date < ?1",
            [today_epoch_day],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if count == 0 {
        return 0;
    }
    conn.execute(
        "UPDATE tasks SET date = ?1, updated_at = ?2 WHERE is_done = 0 AND date < ?1",
        rusqlite::params![today_epoch_day, now_ms()],
    )
    .expect("rollover_overdue execute");
    count
}

// ── Подзадачи ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_subtasks(state: State<'_, Db>, task_id: String) -> Vec<Subtask> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, title, is_done, sort_order, created_at
             FROM subtasks WHERE task_id = ?1 ORDER BY sort_order ASC",
        )
        .expect("prepare get_subtasks");
    stmt.query_map([task_id], |row| {
        Ok(Subtask {
            id: row.get(0)?,
            task_id: row.get(1)?,
            title: row.get(2)?,
            is_done: row.get::<_, i64>(3)? != 0,
            sort_order: row.get(4)?,
            created_at: row.get(5)?,
        })
    })
    .expect("query get_subtasks")
    .filter_map(|r| r.ok())
    .collect()
}

#[tauri::command]
pub fn upsert_subtask(state: State<'_, Db>, mut sub: Subtask) -> Subtask {
    let conn = state.0.lock().unwrap();
    if sub.id.is_empty() {
        sub.id = Uuid::new_v4().to_string();
    }
    if sub.created_at == 0 {
        sub.created_at = now_ms();
    }
    conn.execute(
        "INSERT INTO subtasks (id, task_id, title, is_done, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, is_done=excluded.is_done, sort_order=excluded.sort_order",
        rusqlite::params![
            sub.id, sub.task_id, sub.title, sub.is_done as i64, sub.sort_order, sub.created_at,
        ],
    )
    .expect("upsert_subtask execute");
    sub
}

#[tauri::command]
pub fn delete_subtask(state: State<'_, Db>, id: String) {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM subtasks WHERE id = ?1", [id])
        .expect("delete_subtask");
}
