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
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes
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
            notes: row.get(10)?,
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
        "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, date=excluded.date, is_done=excluded.is_done,
           color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
           updated_at=excluded.updated_at, device_id=excluded.device_id,
           time_minutes=excluded.time_minutes, notes=excluded.notes",
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

/// Экспорт всех данных в JSON-файл по пути (бэкап).
#[tauri::command]
pub fn export_to(state: State<'_, Db>, path: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    let mut sets: Vec<serde_json::Value> = Vec::new();
    let mut tasks: Vec<serde_json::Value> = Vec::new();
    let mut subs: Vec<serde_json::Value> = Vec::new();

    {
        let mut stmt = conn
            .prepare("SELECT id, name, color, sort_order FROM color_sets ORDER BY sort_order ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "name": r.get::<_, String>(1)?,
                    "color": r.get::<_, i64>(2)?,
                    "sortOrder": r.get::<_, f64>(3)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            sets.push(row.map_err(|e| e.to_string())?);
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes FROM tasks ORDER BY sort_order ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "title": r.get::<_, String>(1)?,
                    "date": r.get::<_, i64>(2)?,
                    "isDone": r.get::<_, i64>(3)? != 0,
                    "colorSetId": r.get::<_, Option<String>>(4)?,
                    "sortOrder": r.get::<_, f64>(5)?,
                    "createdAt": r.get::<_, i64>(6)?,
                    "updatedAt": r.get::<_, i64>(7)?,
                    "deviceId": r.get::<_, String>(8)?,
                    "timeMinutes": r.get::<_, Option<i64>>(9)?,
                    "notes": r.get::<_, String>(10)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            tasks.push(row.map_err(|e| e.to_string())?);
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT id, task_id, title, is_done, sort_order, created_at FROM subtasks ORDER BY sort_order ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "taskId": r.get::<_, String>(1)?,
                    "title": r.get::<_, String>(2)?,
                    "isDone": r.get::<_, i64>(3)? != 0,
                    "sortOrder": r.get::<_, f64>(4)?,
                    "createdAt": r.get::<_, i64>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            subs.push(row.map_err(|e| e.to_string())?);
        }
    }

    let payload = serde_json::json!({
        "version": 1,
        "exportedAt": chrono::Utc::now().timestamp_millis(),
        "colorSets": sets,
        "tasks": tasks,
        "subtasks": subs,
    });
    std::fs::write(&path, serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Импорт данных из JSON (полная замена). Возвращает число задач.
#[tauri::command]
pub fn import_from(state: State<'_, Db>, path: String) -> Result<usize, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    // Строгая проверка версии: отсутствие поля или не-целое значение
    // (например, float 1.5) дают unwrap_or(0) → ошибка.
    let version = v.get("version").and_then(|x| x.as_i64()).unwrap_or(0);
    if version != 1 {
        return Err("Неподдерживаемая версия бэкапа".to_string());
    }
    let tasks = v.get("tasks").and_then(|t| t.as_array()).ok_or("Нет массива tasks")?;
    // Клонируем в собственные векторы: &Vec::new() не живёт дольше выражения.
    let sets: Vec<serde_json::Value> =
        v.get("colorSets").and_then(|t| t.as_array()).cloned().unwrap_or_default();
    let subs: Vec<serde_json::Value> =
        v.get("subtasks").and_then(|t| t.as_array()).cloned().unwrap_or_default();

    // conn — MutexGuard<Connection>, поэтому обычная transaction()
    // (unchecked_transaction не нужен: активных prepared-стейтментов нет).
    let mut conn = state.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM subtasks", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tasks", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM color_sets", []).map_err(|e| e.to_string())?;

    for s in sets {
        tx.execute(
            "INSERT INTO color_sets (id, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                s.get("id").and_then(|x| x.as_str()).unwrap_or(""),
                s.get("name").and_then(|x| x.as_str()).unwrap_or(""),
                s.get("color").and_then(|x| x.as_i64()).unwrap_or(0),
                s.get("sortOrder").and_then(|x| x.as_f64()).unwrap_or(0.0),
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for t in tasks {
        tx.execute(
            "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for s in subs {
        tx.execute(
            "INSERT INTO subtasks (id, task_id, title, is_done, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                s.get("id").and_then(|x| x.as_str()).unwrap_or(""),
                s.get("taskId").and_then(|x| x.as_str()).unwrap_or(""),
                s.get("title").and_then(|x| x.as_str()).unwrap_or(""),
                s.get("isDone").and_then(|x| x.as_bool()).unwrap_or(false) as i64,
                s.get("sortOrder").and_then(|x| x.as_f64()).unwrap_or(0.0),
                s.get("createdAt").and_then(|x| x.as_i64()).unwrap_or(0),
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(tasks.len())
}
