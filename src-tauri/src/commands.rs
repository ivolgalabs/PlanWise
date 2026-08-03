use crate::db::Db;
use crate::models::{ColorSet, Subtask, Task};
use chrono::{Datelike, Utc};
use tauri::State;
use uuid::Uuid;

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// epoch-day «сегодня» по локальной дате машины (как toEpochDay на фронте:
/// локальная дата, отсчёт от 1970-01-01). Нужен для правила «перенос задачи
/// в прошлое = задача выполнена».
fn today_epoch_day() -> i64 {
    chrono::Local::now().date_naive().num_days_from_ce() as i64 - 719_162
}

#[tauri::command]
pub fn get_tasks(state: State<'_, Db>, start_day: i64, end_day: i64) -> Vec<Task> {
    let conn = state.0.lock().unwrap();
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
    // Перенос в прошлое = задача закрыта (выполнена); перенос в будущее из
    // прошлого = снова актуальна (не выполнена). Сегодня не трогаем.
    conn.execute(
        "UPDATE tasks SET date = ?1, someday = 0, archived = 0,
           is_done = CASE
             WHEN ?1 < ?2 THEN 1
             WHEN ?1 > ?2 AND is_done = 1 THEN 0
             ELSE is_done END,
           updated_at = ?3 WHERE id = ?4",
        rusqlite::params![new_date, today_epoch_day(), now_ms(), id],
    )
    .expect("move_task");
}

/// Задачи «Когда-нибудь» — без привязки ко дню.
#[tauri::command]
pub fn get_someday_tasks(state: State<'_, Db>) -> Vec<Task> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived
             FROM tasks WHERE someday = 1 AND archived = 0 ORDER BY sort_order ASC, created_at ASC",
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
            archived: row.get::<_, i64>(12)? != 0,
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
        "UPDATE tasks SET someday = 1, date = 0, archived = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now_ms(), id],
    )
    .expect("set_someday");
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
    // Возврат на прошедший день = задача закрыта (иначе на следующем старте
    // она снова уйдёт в архив как просроченная); в будущее = снова актуальна.
    conn.execute(
        "UPDATE tasks SET archived = 0, date = ?1, someday = 0,
           is_done = CASE
             WHEN ?1 < ?2 THEN 1
             WHEN ?1 > ?2 AND is_done = 1 THEN 0
             ELSE is_done END,
           updated_at = ?3 WHERE id = ?4",
        rusqlite::params![date, today_epoch_day(), now_ms(), id],
    )
    .expect("restore_archived");
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
            .prepare("SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived FROM tasks ORDER BY sort_order ASC")
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
                    "someday": r.get::<_, i64>(11)? != 0,
                    "archived": r.get::<_, i64>(12)? != 0,
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
