use crate::db::Db;
use crate::models::{Attachment, ColorSet, Subtask, Task};
use chrono::{Datelike, Utc};
use rusqlite::OptionalExtension;
use tauri::{Manager, State};
use uuid::Uuid;

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// epoch-day «сегодня» по локальной дате машины (как toEpochDay на фронте:
/// локальная дата, отсчёт от 1970-01-01). Нужен для правила «перенос задачи
/// в прошлое = задача выполнена».
///
/// ВНИМАНИЕ: константа 719_163 — это num_days_from_ce(1970-01-01), а не
/// 719_162: при неверной константе «сегодня» сдвигалось на день вперёд и
/// автоархив молча уносил сегодняшние задачи, напоминания не планировались,
/// а виджет «Сегодня» оставался пустым (баг жил с коммита 13a29e0).
pub(crate) fn today_epoch_day() -> i64 {
    chrono::Local::now().date_naive().num_days_from_ce() as i64 - 719_163
}

#[tauri::command]
pub fn get_tasks(state: State<'_, Db>, start_day: i64, end_day: i64) -> Result<Vec<Task>, String> {
    // Защита от недоверенного ввода: обратный диапазон — ошибка. Ширину окна
    // не ограничиваем — фронт грузит все задачи одним запросом (1970–9999).
    if start_day > end_day {
        return Err("Недопустимый диапазон дат".to_string());
    }
    let conn = state.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
             FROM tasks WHERE date BETWEEN ?1 AND ?2 AND someday = 0 AND archived = 0
             ORDER BY sort_order ASC, created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([start_day, end_day], |row| {
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
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        // Ошибка чтения строки — возвращаем, а не молча теряем задачу.
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_task(state: State<'_, Db>, mut task: Task) -> Result<Task, String> {
    {
        let conn = state.lock();
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
    let conn = state.lock();
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
pub fn delete_task(state: State<'_, Db>, app: tauri::AppHandle, id: String) -> Result<(), String> {
    // Сначала соберём файлы вложений, чтобы удалить их с диска после
    // удаления строки (строки attachments каскадом удалит сама БД).
    let files: Vec<String> = {
        let conn = state.lock();
        let mut stmt = conn
            .prepare("SELECT stored_name FROM attachments WHERE task_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };
    let conn = state.lock();
    conn.execute("DELETE FROM tasks WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    drop(conn);
    // Файлы с диска — best effort: остатки (уже удалённые вручную) не страшны.
    let dir = attachments_dir(&app);
    for f in files {
        let _ = std::fs::remove_file(dir.join(f));
    }
    Ok(())
}

#[tauri::command]
pub fn move_task(state: State<'_, Db>, id: String, new_date: i64) -> Result<(), String> {
    let conn = state.lock();
    // Запрет наложений действует и при переносе: читаем задачу, подставляем
    // новую дату и проверяем пересечение (как при сохранении времени).
    let task: Option<Task> = conn
        .query_row(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
             FROM tasks WHERE id = ?1",
            [&id],
            |row| {
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
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(task) = task else {
        return Ok(()); // задачи нет — идемпотентно
    };
    if !task.someday && !task.archived && !task.is_done && task.time_minutes.is_some() {
        let mut moved = task.clone();
        moved.date = new_date;
        check_time_overlap(&conn, &moved)?;
    }
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
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Задачи «Когда-нибудь» — без привязки ко дню.
#[tauri::command]
pub fn get_someday_tasks(state: State<'_, Db>) -> Result<Vec<Task>, String> {
    let conn = state.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
             FROM tasks WHERE someday = 1 AND archived = 0 ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
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
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Переместить задачу в «Когда-нибудь» (дата сбрасывается).
#[tauri::command]
pub fn set_someday(state: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = state.lock();
    conn.execute(
        "UPDATE tasks SET someday = 1, date = 0, archived = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now_ms(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_color_sets(state: State<'_, Db>) -> Result<Vec<ColorSet>, String> {
    let conn = state.lock();
    let mut stmt = conn
        .prepare("SELECT id, name, color, sort_order FROM color_sets ORDER BY sort_order ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ColorSet {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Создать/обновить категорию (цвет-сет). Пустой id — новая категория.
#[tauri::command]
pub fn upsert_color_set(state: State<'_, Db>, mut set: ColorSet) -> Result<ColorSet, String> {
    let conn = state.lock();
    if set.id.is_empty() {
        set.id = Uuid::new_v4().to_string();
    }
    conn.execute(
        "INSERT INTO color_sets (id, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color,
           sort_order=excluded.sort_order",
        rusqlite::params![set.id, set.name, set.color, set.sort_order],
    )
    .map_err(|e| e.to_string())?;
    Ok(set)
}

/// Удалить категорию. Задачи с ней становятся «без категории» (NULL).
#[tauri::command]
pub fn delete_color_set(state: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = state.lock();
    // Служебный сет «Без категории» (cs-none) удалять нельзя — на него
    // завязан NULL-смысл color_set_id.
    if id == "cs-none" {
        return Ok(());
    }
    // Обе операции атомарно: сбой одной не оставит задачи без категории
    // и «висящий» сет. Несуществующий сет — не ошибка (идемпотентность).
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM color_sets WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tasks SET color_set_id = NULL, updated_at = ?1 WHERE color_set_id = ?2",
        rusqlite::params![now_ms(), &id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM color_sets WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Перенос просроченных невыполненных задач в «Архив» (вместо переноса на
/// сегодня). Возвращает количество заархивированных задач (для баннера в UI).
/// Граница «сегодня» — бэкендная (today_epoch_day), а не с фронта: часы
/// устройства и даты задач не должны расходиться с логикой переноса.
///
/// Грейс-период: архивируются только задачи, отстающие от локального
/// «сегодня» минимум на двое суток (date < today - 1). Причина: «сегодня»
/// считается по часам каждого устройства, и на устройстве с другим часовым
/// поясом (или сбитыми часами) свежая задача «на вчера» выглядела бы
/// просроченной и молча уезжала в архив. Двухсуточный запас делает архивацию
/// одинаковой на всех машинах — задача исчезает из видов в один и тот же
/// момент независимо от таймзоны.
#[tauri::command]
pub fn archive_overdue(state: State<'_, Db>) -> Result<i64, String> {
    let today = today_epoch_day() - 1;
    let conn = state.lock();
    // Подсчёт и обновление — в одной транзакции (атомарно).
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE is_done = 0 AND date < ?1 AND someday = 0 AND archived = 0",
            [today],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count == 0 {
        return Ok(0);
    }
    tx.execute(
        "UPDATE tasks SET archived = 1, updated_at = ?1 WHERE is_done = 0 AND date < ?2 AND someday = 0 AND archived = 0",
        rusqlite::params![now_ms(), today],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

/// Задачи «Архива» — скрытые из видов, ждут возврата на дату.
#[tauri::command]
pub fn get_archived_tasks(state: State<'_, Db>) -> Result<Vec<Task>, String> {
    let conn = state.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
             FROM tasks WHERE archived = 1 ORDER BY date DESC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
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
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Вернуть задачу из «Архива» на выбранную дату (archived снимается).
#[tauri::command]
pub fn restore_archived(state: State<'_, Db>, id: String, date: i64) -> Result<(), String> {
    let conn = state.lock();
    // Запрет наложений действует и при возврате из архива: проверяем время
    // восстановленной задачи на целевой дате (как при переносе).
    let task: Option<Task> = conn
        .query_row(
            "SELECT id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes
             FROM tasks WHERE id = ?1",
            [&id],
            |row| {
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
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(task) = task else {
        return Ok(());
    };
    if !task.is_done && task.time_minutes.is_some() {
        let mut restored = task.clone();
        restored.archived = false; // после возврата задача снова активна
        restored.date = date;
        check_time_overlap(&conn, &restored)?;
    }
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
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Подзадачи ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_subtasks(state: State<'_, Db>, task_id: String) -> Result<Vec<Subtask>, String> {
    let conn = state.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, title, is_done, sort_order, created_at
             FROM subtasks WHERE task_id = ?1 ORDER BY sort_order ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([task_id], |row| {
            Ok(Subtask {
                id: row.get(0)?,
                task_id: row.get(1)?,
                title: row.get(2)?,
                is_done: row.get::<_, i64>(3)? != 0,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_subtask(state: State<'_, Db>, mut sub: Subtask) -> Result<Subtask, String> {
    let conn = state.lock();
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
    .map_err(|e| e.to_string())?;
    Ok(sub)
}

#[tauri::command]
pub fn delete_subtask(state: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = state.lock();
    conn.execute("DELETE FROM subtasks WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Экспорт всех данных JSON-строкой (файл пишет tauri-plugin-fs — на Android
/// системные диалоги возвращают content://, который std::fs не понимает).
#[tauri::command]
pub fn export_json(app: tauri::AppHandle, state: State<'_, Db>) -> Result<String, String> {
    let conn = state.lock();
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

    // Вложения: метаданные + base64 самих файлов (иначе бэкап теряет файлы —
    // при импорте FK-каскад DELETE tasks уничтожил бы все вложения).
    let mut atts: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, task_id, file_name, mime, size, stored_name, created_at FROM attachments ORDER BY created_at ASC",
    ) {
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, task_id, file_name, mime, size, stored_name, created_at) =
                row.map_err(|e| e.to_string())?;
            let data = std::fs::read(attachments_dir(&app).join(&stored_name)).ok();
            atts.push(serde_json::json!({
                "id": id,
                "taskId": task_id,
                "fileName": file_name,
                "mime": mime,
                "size": size,
                "storedName": stored_name,
                "createdAt": created_at,
                "base64": data.map(|d| {
                    use base64::Engine as _;
                    base64::engine::general_purpose::STANDARD.encode(d)
                }),
            }));
        }
    }

    let payload = serde_json::json!({
        "version": 2,
        "exportedAt": chrono::Utc::now().timestamp_millis(),
        "colorSets": sets,
        "tasks": tasks,
        "subtasks": subs,
        "attachments": atts,
    });
    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
}

/// Импорт данных из JSON-строки (полная замена в транзакции: при ошибке —
/// откат, старые данные остаются). Отсутствующие поля берутся как дефолты,
/// лишние/неизвестные поля игнорируются. Версии бэкапа: 1 (без вложений) и
/// 2 (с вложениями).
#[tauri::command]
pub fn import_json(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    json: String,
) -> Result<usize, String> {
    // Защита от гигантских payload: 100 МБ строки достаточно для бэкапа
    // личного планировщика (включая вложения до 25 МБ каждое).
    if json.len() > 100 * 1024 * 1024 {
        return Err("Файл бэкапа больше 100 МБ".to_string());
    }
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    // Строгая проверка версии: отсутствие поля или не-целое значение
    // (например, float 1.5) дают unwrap_or(0) → ошибка.
    let version = v.get("version").and_then(|x| x.as_i64()).unwrap_or(0);
    if version != 1 && version != 2 {
        return Err("Неподдерживаемая версия бэкапа".to_string());
    }
    let tasks = v
        .get("tasks")
        .and_then(|t| t.as_array())
        .ok_or("Нет массива tasks")?;
    // Ограничение числа элементов: 100k задач больше чем достаточно.
    if tasks.len() > 100_000 {
        return Err("Слишком много задач в бэкапе".to_string());
    }
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
    let atts: Vec<serde_json::Value> = v
        .get("attachments")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();

    // conn — MutexGuard<Connection>, поэтому обычная transaction()
    // (unchecked_transaction не нужен: активных prepared-стейтментов нет).
    let mut conn = state.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // Соберём имена файлов текущих вложений — после импорта удалим те, что
    // не вошли в новый набор (сироты от каскадного удаления задач).
    let mut old_files: Vec<String> = Vec::new();
    {
        let mut stmt = tx
            .prepare("SELECT stored_name FROM attachments")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for r in rows {
            old_files.push(r.map_err(|e| e.to_string())?);
        }
    }
    tx.execute("DELETE FROM subtasks", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM attachments", [])
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
    // Вложения (версия бэкапа 2): строка в БД + файл на диск (base64 → bytes).
    // Если файла в бэкапе нет (старый бэкап v1) — только метаданные не пишем:
    // вложения целиком пропускаем, сироты почистим ниже.
    let mut new_files: std::collections::HashSet<String> = std::collections::HashSet::new();
    let dir = attachments_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for a in atts {
        let stored = a.get("storedName").and_then(|x| x.as_str()).unwrap_or("");
        let b64 = a.get("base64").and_then(|x| x.as_str());
        let Some(b64) = b64 else { continue };
        let data =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64.as_bytes())
                .map_err(|e| format!("Не удалось декодировать вложение: {e}"))?;
        if data.is_empty() || stored.is_empty() {
            continue;
        }
        // Безопасное имя: только существовавшие на диске файлы (uuid.ext).
        if !stored
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.')
        {
            continue;
        }
        new_files.insert(stored.to_string());
        std::fs::write(dir.join(stored), &data).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO attachments (id, task_id, file_name, mime, size, stored_name, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                a.get("id").and_then(|x| x.as_str()).unwrap_or(""),
                a.get("taskId").and_then(|x| x.as_str()).unwrap_or(""),
                a.get("fileName").and_then(|x| x.as_str()).unwrap_or("file"),
                a.get("mime").and_then(|x| x.as_str()).unwrap_or(""),
                a.get("size")
                    .and_then(|x| x.as_i64())
                    .unwrap_or(data.len() as i64),
                stored,
                a.get("createdAt").and_then(|x| x.as_i64()).unwrap_or(0),
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    // Чистка сирот: файлы старых вложений, не вошедшие в новый набор.
    for f in old_files {
        if !new_files.contains(&f) {
            let _ = std::fs::remove_file(dir.join(f));
        }
    }
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
    let conn = state.lock();
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .ok()
}

/// Сохранить настройку приложения в таблицу settings (upsert по ключу).
#[tauri::command]
pub fn set_setting(state: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    // Защита от недоверенного ввода: ключ до 100 символов, значение до 10 КБ.
    if key.len() > 100 || value.len() > 10_000 {
        return Err("Значение настройки слишком длинное".to_string());
    }
    let conn = state.lock();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Записать данные для виджетов (Android и macOS) в widget.json.
/// Вызывается фронтендом при перезагрузке задач И планировщиком каждый тик —
/// виджет всегда получает свежие данные, даже если приложение не открывали.
/// `dark` — эффективная тема приложения (светлая/тёмная), чтобы виджет
/// выглядел так же, как интерфейс, а не по системной теме устройства.
#[tauri::command]
pub fn write_widget_data(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    dark: Option<bool>,
) -> Result<(), String> {
    refresh_widget(&app, &state, dark.unwrap_or(false))?;
    // После записи файла сразу просим Android-виджет перечитать его —
    // иначе он ждёт системного обновления до 30 минут.
    push_widget_refresh(&app);
    Ok(())
}

/// Уведомить Kotlin-виджет (WidgetPushPlugin) о новых данных. Вызывается после
/// каждой записи widget.json, когда приложение живо. Плагин перечитывает файл
/// и перерисовывает виджеты мгновенно; когда процесс убит — виджет
/// обновляется сам (AlarmManager в Kotlin).
#[cfg(target_os = "android")]
fn push_widget_refresh(app: &tauri::AppHandle) {
    // Async-вариант обязателен: sync-версия run_mobile_plugin блокирует
    // вызывающий поток до ответа главного потока Android — из команды на
    // главном потоке это дедлок.
    if let Some(state) = app.try_state::<crate::WidgetPush>() {
        if let Some(handle) = &state.0 {
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                let _ = h.run_mobile_plugin_async::<()>("refresh", ()).await;
            });
        }
    }
}

#[cfg(not(target_os = "android"))]
fn push_widget_refresh(_app: &tauri::AppHandle) {}

/// Тема (dark), сохранённая в последнем widget.json. Планировщик перезаписывает
/// файл при смене дня и не должен сбрасывать тему на светлую — берём её из
/// предыдущей записи.
pub fn read_widget_dark(app: &tauri::AppHandle) -> bool {
    #[cfg_attr(not(target_os = "android"), allow(unused_mut))]
    let mut dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    #[cfg(target_os = "android")]
    {
        dir = dir.join("files");
    }
    let raw = std::fs::read_to_string(dir.join("widget.json")).unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("dark").and_then(|d| d.as_bool()))
        .unwrap_or(false)
}

/// Общая логика записи виджет-данных (без State — для вызова из планировщика).
/// Формат один для Android- и macOS-виджетов: сегодня (`date`/`tasks`),
/// неделя (`week` — 7 дней с сегодня), «Когда-нибудь» (`someday`) и тема
/// (`dark`).
pub fn refresh_widget(
    app: &tauri::AppHandle,
    state: &State<'_, Db>,
    dark: bool,
) -> Result<(), String> {
    let conn = state.lock();
    let today = today_epoch_day();
    // Строка задачи в JSON: одинаковая для всех выборок. id нужен виджету,
    // чтобы отмечать задачу выполненной тапом по строке (UPDATE по id).
    let task_row = |r: &rusqlite::Row| {
        Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?,
            "title": r.get::<_, String>(1)?,
            "timeMinutes": r.get::<_, Option<i64>>(2)?,
            "isDone": r.get::<_, i64>(3)? != 0,
        }))
    };
    // Задачи по одному аргументу-дате (someday-запрос параметров не имеет —
    // для него отдельная ветка ниже).
    let query_by_day =
        |conn: &rusqlite::Connection, sql: &str, day: i64| -> Vec<serde_json::Value> {
            conn.prepare(sql)
                .and_then(|mut stmt| {
                    stmt.query_map([day], task_row)
                        .and_then(|it| it.collect::<Result<Vec<_>, _>>())
                })
                .unwrap_or_default()
        };
    // Сегодня — до 8 задач (Android-виджет и день на macOS). Порядок — как
    // просил пользователь: сначала задачи С временем (по времени), затем без
    // времени по приоритету (difficulty), tie-break — ручной порядок.
    // Лимит 4 в неделе: остальное — в приложении.
    let tasks = query_by_day(
        &conn,
        "SELECT id, title, time_minutes, is_done FROM tasks WHERE date = ?1 AND archived = 0 AND someday = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 8",
        today,
    );
    // Неделя: 7 дней с сегодня, до 4 задач на день (самые значимые: сначала
    // с временем, затем по приоритету) — для виджета «Неделя».
    let week: Vec<serde_json::Value> = (0..7)
        .map(|off| {
            let day = today + off;
            let day_tasks = query_by_day(
                &conn,
                "SELECT id, title, time_minutes, is_done FROM tasks WHERE date = ?1 AND archived = 0 AND someday = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 4",
                day,
            );
            serde_json::json!({ "date": day, "tasks": day_tasks })
        })
        .collect();
    // «Когда-нибудь» — задачи без даты, до 8 (без параметров).
    let someday: Vec<serde_json::Value> = conn
        .prepare("SELECT id, title, time_minutes, is_done FROM tasks WHERE someday = 1 AND archived = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 8")
        .and_then(|mut stmt| stmt.query_map([], task_row).and_then(|it| it.collect::<Result<Vec<_>, _>>()))
        .unwrap_or_default();
    // Окно дней для интерактивного виджета «День»: вчера..+13, до 8 задач на
    // день. Стрелки ‹ › в виджете переключают показанный день без захода
    // в приложение; данные уже все в файле, запрос не нужен. +13 — чтобы
    // задачи, добавленные через «Другая дата», были видны в виджете.
    let day_window: Vec<serde_json::Value> = (-1..=13)
        .map(|off| {
            let day = today + off;
            let day_tasks = query_by_day(
                &conn,
                "SELECT id, title, time_minutes, is_done FROM tasks WHERE date = ?1 AND archived = 0 AND someday = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 8",
                day,
            );
            serde_json::json!({ "date": day, "tasks": day_tasks })
        })
        .collect();
    let payload = serde_json::json!({
        "date": today,
        "tasks": tasks,
        "week": week,
        "someday": someday,
        "dayWindow": day_window,
        "dark": dark,
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
    // Атомарная запись: tmp + rename — виджет (отдельный процесс) никогда не
    // прочитает обрезанный JSON, даже если два писателя (фронт и тикер)
    // пишут одновременно.
    let data = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let tmp = dir.join("widget.json.tmp");
    std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("widget.json")).map_err(|e| e.to_string())?;
    // macOS: дублируем в App Group контейнер — WidgetKit-расширение песочное
    // и читает только свой контейнер группы (group.com.zkproject.dailyplanner).
    // Ошибки логируем, а не глотаем: молчаливый сбой здесь = вечно пустой
    // виджет в Центре уведомлений с непонятной причиной.
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let group_dir = std::path::PathBuf::from(home)
            .join("Library/Group Containers/group.com.zkproject.dailyplanner");
        if !group_dir.as_os_str().is_empty() {
            if let Err(e) = std::fs::create_dir_all(&group_dir) {
                eprintln!("[widget] не удалось создать App Group каталог: {e}");
            } else {
                let g_tmp = group_dir.join("widget.json.tmp");
                if let Err(e) = std::fs::write(&g_tmp, &data) {
                    eprintln!("[widget] запись widget.json.tmp в App Group: {e}");
                }
                if let Err(e) = std::fs::rename(&g_tmp, group_dir.join("widget.json")) {
                    eprintln!("[widget] rename widget.json в App Group: {e}");
                }
            }
        }
    }
    Ok(())
}

/// Удалить файлы вложений, у которых нет строки в БД. Сироты появляются при
/// сбое между записью файла и INSERT (обрыв процесса), при частичном импорте
/// или ручном удалении записей. Вызывается при старте — иначе файлы
/// копились бы на диске бесконечно.
pub fn cleanup_orphan_attachments(app: &tauri::AppHandle, state: &State<'_, Db>) {
    let dir = attachments_dir(app);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return; // каталога ещё нет — сирот нет
    };
    let conn = state.lock();
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM attachments WHERE stored_name = ?1",
                [&name],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !exists {
            if let Err(e) = std::fs::remove_file(entry.path()) {
                eprintln!(
                    "[attachments] не удалось удалить сироту {}: {e}",
                    entry.path().display()
                );
            }
        }
    }
}

// ── Вложения заметок (файлы) ──────────────────────────────────────────

/// Каталог вложений: на Android app_data_dir/files/attachments (там же, где
/// widget.json — context.filesDir), на десктопе — app_data_dir/attachments.
#[cfg_attr(not(target_os = "android"), allow(unused_mut))]
fn attachments_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let mut dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    #[cfg(target_os = "android")]
    {
        dir = dir.join("files");
    }
    dir.join("attachments")
}

/// Расширение из имени файла (санитизированное, до 8 символов): "a.TXT" → "txt".
fn safe_ext(file_name: &str) -> String {
    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase();
    if ext.is_empty() {
        "bin".to_string()
    } else {
        ext
    }
}

/// Максимальный размер вложения (байт) — 25 МБ: файл передаётся base64-строкой
/// через IPC, слишком большие файлы съедают память WebView.
const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;

/// Список вложений задачи.
#[tauri::command]
pub fn list_attachments(state: State<'_, Db>, task_id: String) -> Result<Vec<Attachment>, String> {
    let conn = state.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, file_name, mime, size, created_at
             FROM attachments WHERE task_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([task_id], |r| {
            Ok(Attachment {
                id: r.get(0)?,
                task_id: r.get(1)?,
                file_name: r.get(2)?,
                mime: r.get(3)?,
                size: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Добавить вложение к задаче: файл приходит base64-строкой (на Android путь
/// content:// из диалога умеет читать только фронтенд через plugin-fs), Rust
/// декодирует и сохраняет в приватный каталог приложения.
#[tauri::command]
pub fn add_attachment(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    task_id: String,
    file_name: String,
    mime: String,
    data_b64: String,
) -> Result<Attachment, String> {
    // Ограничение размера: 4 байта base64 ≈ 3 байта данных.
    let approx = data_b64.len() / 4 * 3;
    if approx > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "Файл больше 25 МБ ({:.1} МБ)",
            approx as f64 / 1_048_576.0
        ));
    }
    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data_b64.as_bytes(),
    )
    .map_err(|e| format!("Не удалось декодировать файл: {e}"))?;
    if data.is_empty() {
        return Err("Пустой файл".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let stored = format!("{}.{}", Uuid::new_v4().simple(), safe_ext(&file_name));
    let dir = attachments_dir(&app);
    // Проверяем, что задача существует, ДО записи файла: иначе при сбое
    // INSERT (FK) файл остался бы сиротой на диске.
    let conn = state.lock();
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM tasks WHERE id = ?1",
            [&task_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Задача не найдена".to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(&stored), &data).map_err(|e| e.to_string())?;

    let att = Attachment {
        id: id.clone(),
        task_id: task_id.clone(),
        file_name: file_name.clone(),
        mime,
        size: data.len() as i64,
        created_at: now_ms(),
    };
    let res = conn.execute(
        "INSERT INTO attachments (id, task_id, file_name, mime, size, stored_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            task_id,
            file_name,
            att.mime,
            att.size,
            stored,
            att.created_at
        ],
    );
    if let Err(e) = res {
        // Откат: удаляем записанный файл, чтобы не оставлять сирот.
        let _ = std::fs::remove_file(dir.join(&stored));
        return Err(e.to_string());
    }
    Ok(att)
}

/// Удалить вложение: строка из БД + файл с диска.
#[tauri::command]
pub fn delete_attachment(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    id: String,
) -> Result<(), String> {
    let stored: Option<String> = {
        let conn = state.lock();
        conn.query_row(
            "SELECT stored_name FROM attachments WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    let conn = state.lock();
    conn.execute("DELETE FROM attachments WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    drop(conn);
    if let Some(f) = stored {
        let _ = std::fs::remove_file(attachments_dir(&app).join(f));
    }
    Ok(())
}

/// Абсолютный путь файла вложения — для открытия системным приложением
/// (tauri-plugin-opener: на Android через FileProvider, на десктопе напрямую).
#[tauri::command]
pub fn attachment_path(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let stored: Option<String> = {
        let state = app.state::<Db>();
        let conn = state.lock();
        conn.query_row(
            "SELECT stored_name FROM attachments WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    let Some(stored) = stored else {
        return Err("Вложение не найдено".to_string());
    };
    let path = attachments_dir(&app).join(stored);
    if !path.exists() {
        return Err("Файл вложения не найден на диске".to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}
