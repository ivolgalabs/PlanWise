use crate::db::Db;
use crate::models::{ColorSet, Task};
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
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id
             FROM tasks WHERE date BETWEEN ?1 AND ?2 ORDER BY sort_order ASC",
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
        "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, date=excluded.date, is_done=excluded.is_done,
           color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
           updated_at=excluded.updated_at, device_id=excluded.device_id",
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
