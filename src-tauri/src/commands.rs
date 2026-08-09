use crate::db::Db;
use crate::models::{ColorSet, Subtask, Task};
use chrono::{Datelike, Utc};
use tauri::{Manager, State};
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
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
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
            travel_time: row.get(13)?,
            duration_minutes: row.get(14)?,
            difficulty: row.get(15)?,
            notify_minutes: row.get(16)?,
        })
    })
    .expect("query get_tasks")
    .filter_map(|r| r.ok())
    .collect()
}

#[tauri::command]
pub fn upsert_task(state: State<'_, Db>, mut task: Task) -> Result<Task, String> {
    {
        let conn = state.0.lock().unwrap();
        // Правка текста/заметки существующей задачи — время не меняется:
        // такое пересохранение не проверяем (иначе старые конфликты не дали
        // бы редактировать текст, а свои же конфликтные задачи не исправить).
        let same_as_db: bool = conn
            .query_row(
                "SELECT time_minutes, duration_minutes, date FROM tasks WHERE id = ?1",
                [&task.id],
                |r| {
                    Ok((
                        r.get::<_, Option<i64>>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                },
            )
            .map(|(tm, dur, date)| {
                tm == task.time_minutes.map(|v| v as i64)
                    && dur == task.duration_minutes.map(|v| v as i64)
                    && date == task.date
            })
            .unwrap_or(false); // id нет в БД — это новая задача, проверяем
        if !same_as_db {
            // Запрет наложений: если настройка включена, не даём сохранить
            // задачу на время, пересекающееся с другой задачей того же дня.
            // Проверка на сервере — все пути сохранения (ввод, шаблоны,
            // импорт) проходят сюда.
            check_time_overlap(&conn, &task)?;
        }
    }
    let conn = state.0.lock().unwrap();
    if task.id.is_empty() {
        task.id = Uuid::new_v4().to_string();
    }
    if task.created_at == 0 {
        task.created_at = now_ms();
    }
    task.updated_at = now_ms();
    conn.execute(
        "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, date=excluded.date, is_done=excluded.is_done,
           color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
           updated_at=excluded.updated_at, device_id=excluded.device_id,
           time_minutes=excluded.time_minutes, notes=excluded.notes,
           someday=excluded.someday, archived=excluded.archived,
           travel_time=excluded.travel_time, duration_minutes=excluded.duration_minutes,
           difficulty=excluded.difficulty, notify_minutes=excluded.notify_minutes",
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
            task.travel_time,
            task.duration_minutes,
            task.difficulty,
            task.notify_minutes,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(task)
}

/// Проверка пересечения времени с другими задачами дня (настройка
/// «запрещать наложения» в таблице settings, ключ prevent_overlaps).
/// Интервал задачи — [start, start+duration); без длительности занимает
/// одну минуту (мгновение) — две задачи «в одно время» конфликтуют,
/// а «встык» (12:00–13:00 и 13:00–14:00) — нет.
fn check_time_overlap(conn: &rusqlite::Connection, task: &Task) -> Result<(), String> {
    let Some(start) = task.time_minutes else {
        return Ok(()); // «в течение дня» — конфликтов не бывает
    };
    if task.someday || task.archived || task.is_done {
        return Ok(());
    }
    let prevent: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'prevent_overlaps'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "1")
        .unwrap_or(true); // дефолт — запрещать
    if !prevent {
        return Ok(());
    }
    let start = start as i64;
    let end = start + (task.duration_minutes.unwrap_or(0).max(1)) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, time_minutes, duration_minutes FROM tasks
             WHERE date = ?1 AND id != ?2 AND is_done = 0 AND archived = 0
               AND someday = 0 AND time_minutes IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![task.date, task.id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<i64>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (_id, title, s2, d2) = row.map_err(|e| e.to_string())?;
        let e2 = s2 + d2.unwrap_or(0).max(1);
        if start < e2 && s2 < end {
            // Пересечение — понятное сообщение с диапазоном занятой задачи.
            let mut span = format!("{:02}:{:02}", s2 / 60, s2 % 60);
            if let Some(d) = d2 {
                if d > 0 {
                    let e2m = (s2 + d) % (24 * 60);
                    span.push_str(&format!("–{:02}:{:02}", e2m / 60, e2m % 60));
                }
            }
            return Err(format!("Время занято задачей «{}» ({})", title, span));
        }
    }
    Ok(())
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
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
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
            travel_time: row.get(13)?,
            duration_minutes: row.get(14)?,
            difficulty: row.get(15)?,
            notify_minutes: row.get(16)?,
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
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
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
            travel_time: row.get(13)?,
            duration_minutes: row.get(14)?,
            difficulty: row.get(15)?,
            notify_minutes: row.get(16)?,
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
            sub.id,
            sub.task_id,
            sub.title,
            sub.is_done as i64,
            sub.sort_order,
            sub.created_at,
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
    let json = export_json(state)?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Экспорт всех данных JSON-строкой (файл пишет tauri-plugin-fs — на Android
/// системные диалоги возвращают content://, который std::fs не понимает).
#[tauri::command]
pub fn export_json(state: State<'_, Db>) -> Result<String, String> {
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
            .prepare("SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes FROM tasks ORDER BY sort_order ASC")
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
                    "travelTime": r.get::<_, Option<i64>>(13)?,
                    "durationMinutes": r.get::<_, Option<i64>>(14)?,
                    "difficulty": r.get::<_, i64>(15)?,
                    "notifyMinutes": r.get::<_, Option<i64>>(16)?,
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
    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
}

/// Импорт данных из JSON-строки (полная замена в транзакции: при ошибке —
/// откат, старые данные остаются). Отсутствующие поля берутся как дефолты,
/// лишние/неизвестные поля игнорируются.
#[tauri::command]
pub fn import_json(state: State<'_, Db>, json: String) -> Result<usize, String> {
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    // Строгая проверка версии: отсутствие поля или не-целое значение
    // (например, float 1.5) дают unwrap_or(0) → ошибка.
    let version = v.get("version").and_then(|x| x.as_i64()).unwrap_or(0);
    if version != 1 {
        return Err("Неподдерживаемая версия бэкапа".to_string());
    }
    let tasks = v
        .get("tasks")
        .and_then(|t| t.as_array())
        .ok_or("Нет массива tasks")?;
    // Клонируем в собственные векторы: &Vec::new() не живёт дольше выражения.
    let sets: Vec<serde_json::Value> = v
        .get("colorSets")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    let subs: Vec<serde_json::Value> = v
        .get("subtasks")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();

    // conn — MutexGuard<Connection>, поэтому обычная transaction()
    // (unchecked_transaction не нужен: активных prepared-стейтментов нет).
    let mut conn = state.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM subtasks", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tasks", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM color_sets", [])
        .map_err(|e| e.to_string())?;

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
            "INSERT INTO tasks (id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
                t.get("travelTime").and_then(|x| x.as_i64()),
                t.get("durationMinutes").and_then(|x| x.as_i64()),
                t.get("difficulty").and_then(|x| x.as_i64()).unwrap_or(0),
                t.get("notifyMinutes").and_then(|x| x.as_i64()),
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

/// Закрывает приложение (системная кнопка «назад» на Android, когда все
/// модалки закрыты). app.exit(0) завершает и десктоп, и мобильный процесс.
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Сохранить настройки уведомлений (планировщик подхватит в течение ~20с).
#[tauri::command]
pub fn set_notification_prefs(
    app: tauri::AppHandle,
    prefs: crate::notify::NotifyPrefs,
) -> Result<(), String> {
    crate::notify::save_prefs(&app, &prefs)
}

/// Значение настройки приложения из таблицы settings (key/value).
/// Возвращает None, если ключа нет (фронт применяет свой дефолт).
#[tauri::command]
pub fn get_setting(state: State<'_, Db>, key: String) -> Option<String> {
    let conn = state.0.lock().unwrap();
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .ok()
}

/// Сохранить настройку приложения в таблицу settings (upsert по ключу).
#[tauri::command]
pub fn set_setting(state: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Записать данные для Android-виджета (задачи на сегодня) в files/widget.json.
/// Вызывается фронтендом при перезагрузке задач И планировщиком каждый тик —
/// виджет всегда получает свежие данные, даже если приложение не открывали.
#[tauri::command]
pub fn write_widget_data(app: tauri::AppHandle, state: State<'_, Db>) -> Result<(), String> {
    refresh_widget(&app, &state)
}

/// Общая логика записи виджет-данных (без State — для вызова из планировщика).
pub fn refresh_widget(app: &tauri::AppHandle, state: &State<'_, Db>) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    let today = today_epoch_day();
    let tasks: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare("SELECT title, time_minutes, is_done FROM tasks WHERE date = ?1 AND archived = 0 AND someday = 0 ORDER BY sort_order ASC LIMIT 8")
            .map_err(|e| e.to_string())?;
        stmt.query_map([today], |r| {
            Ok(serde_json::json!({
                "title": r.get::<_, String>(0)?,
                "timeMinutes": r.get::<_, Option<i64>>(1)?,
                "isDone": r.get::<_, i64>(2)? != 0,
            }))
        })
        .and_then(|it| it.collect::<Result<Vec<_>, _>>())
        .unwrap_or_default()
    };
    let payload = serde_json::json!({
        "date": today,
        "tasks": tasks,
    });
    // На Android каталог data-файлов — data/files; на десктопе dir не меняется.
    #[cfg_attr(not(target_os = "android"), allow(unused_mut))]
    let mut dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    // На Android app_data_dir — корень data-каталога, а Kotlin-виджет читает
    // context.filesDir (= data/files). Пишем туда же, иначе виджет не видит
    // данные (старый баг «виджет пустой» — пути не совпадали).
    #[cfg(target_os = "android")]
    {
        dir = dir.join("files");
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("widget.json"),
        serde_json::to_string(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
