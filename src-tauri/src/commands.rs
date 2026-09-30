use crate::db::Db;
use crate::models::{Attachment, ColorSet, Subtask, Task};
use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use tauri::{Manager, State};
use uuid::Uuid;

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// Колонки таблицы tasks — единый список для SELECT и INSERT: новая колонка
/// добавляется в одном месте (маппинг в Task — см. task_from_row).
pub(crate) const TASK_COLUMNS: &str = "id, title, date, is_done, color_set_id, sort_order, created_at, updated_at, device_id, time_minutes, notes, someday, archived, travel_time, duration_minutes, difficulty, notify_minutes, travel_notify_minutes, due_epoch_day";

/// Маппинг строки tasks в Task (единый для всех выборок — колонки не разъезжаются).
fn task_from_row(row: &rusqlite::Row) -> rusqlite::Result<Task> {
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
        travel_notify_minutes: row.get(17)?,
        due_epoch_day: row.get(18)?,
    })
}

/// Задачи, подходящие под tail (всё после «FROM tasks»: WHERE и ORDER BY).
/// params — параметры tail; единая точка маппинга колонок (task_from_row).
fn select_tasks(
    conn: &rusqlite::Connection,
    tail: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Task>, String> {
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks {tail}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, task_from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        // Ошибка чтения строки — возвращаем, а не молча теряем задачу.
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Одна задача по id (None, если такой задачи нет).
fn select_task_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Option<Task>, String> {
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row([id], task_from_row)
        .optional()
        .map_err(|e| e.to_string())
}

/// Перенос задачи на дату: в прошлое = выполнена, в будущее (из прошлого) =
/// актуальна. Общее для переноса и возврата из архива.
fn move_task_to_date(conn: &rusqlite::Connection, id: &str, new_date: i64) -> Result<(), String> {
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

/// epoch-day «сегодня» по локальной дате машины (как toEpochDay на фронте:
/// локальная дата, отсчёт от 1970-01-01). Нужен для правила «перенос задачи
/// в прошлое = задача выполнена».
pub(crate) fn today_epoch_day() -> i64 {
    date_to_epoch(chrono::Local::now().date_naive())
}

/// Прямое преобразование: дата → epoch-day (счёт от 1970-01-01).
///
/// ВНИМАНИЕ: константа 719_163 — это num_days_from_ce(1970-01-01), а не
/// 719_162: при неверной константе «сегодня» сдвигалось на день вперёд и
/// автоархив молча уносил сегодняшние задачи, напоминания не планировались,
/// а виджет «Сегодня» оставался пустым (баг жил с коммита 13a29e0).
pub(crate) fn date_to_epoch(d: NaiveDate) -> i64 {
    d.num_days_from_ce() as i64 - 719_163
}

/// Обратное преобразование: epoch-day → дата.
pub(crate) fn epoch_to_date(days: i64) -> Option<NaiveDate> {
    NaiveDate::from_num_days_from_ce_opt((days + 719_163) as i32)
}

#[tauri::command]
pub fn get_tasks(state: State<'_, Db>, start_day: i64, end_day: i64) -> Result<Vec<Task>, String> {
    // Защита от недоверенного ввода: обратный диапазон — ошибка. Ширину окна
    // не ограничиваем — фронт грузит все задачи одним запросом (1970–9999).
    if start_day > end_day {
        return Err("Недопустимый диапазон дат".to_string());
    }
    let conn = state.lock();
    select_tasks(
        &conn,
        "WHERE date BETWEEN ?1 AND ?2 AND someday = 0 AND archived = 0 ORDER BY sort_order ASC, created_at ASC, id ASC",
        &[&start_day, &end_day],
    )
}

#[tauri::command]
pub fn upsert_task(state: State<'_, Db>, mut task: Task) -> Result<Task, String> {
    // Одна блокировка на проверку и вставку: иначе два параллельных
    // сохранения могли бы оба пройти проверку наложений и вставить конфликт.
    let conn = state.lock();
    // Границы полей — до любых проверок: и наложения, и напоминания считают
    // по sanitized-значениям.
    sanitize_task(&mut task);
    // Правка текста/заметки существующей задачи — время не меняется:
    // такое пересохранение не проверяем (иначе старые конфликты не дали
    // бы редактировать текст, а свои же конфликтные задачи не исправить).
    let same_as_db: bool = conn
        .query_row(
            "SELECT time_minutes, duration_minutes, date, someday, archived, is_done FROM tasks WHERE id = ?1",
            [&task.id],
            |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            },
        )
        .map(|(tm, dur, date, someday, archived, done)| {
            tm == task.time_minutes.map(|v| v as i64)
                && dur == task.duration_minutes.map(|v| v as i64)
                && date == task.date
                // Возврат из архива/снятие «Когда-нибудь» делает задачу снова
                // активной — такую правку проверяем как обычно (иначе задача
                // вставала в занятый слот мимо запрета наложений).
                && someday == i64::from(task.someday)
                && archived == i64::from(task.archived)
                && done == i64::from(task.is_done)
        })
        .unwrap_or(false); // id нет в БД — это новая задача, проверяем
    if !same_as_db {
        // Запрет наложений: если настройка включена, не даём сохранить
        // задачу на время, пересекающееся с другой задачей того же дня.
        // Проверка на сервере — все пути сохранения (ввод, шаблоны,
        // импорт) проходят сюда.
        check_time_overlap(&conn, &task)?;
    }
    if task.id.is_empty() {
        task.id = Uuid::new_v4().to_string();
    }
    if task.created_at == 0 {
        task.created_at = now_ms();
    }
    task.updated_at = now_ms();
    write_task(&conn, &task)?;
    // Пересчёт расписания уведомлений: без этого планировщик до следующего
    // тика считал бы по устаревшим данным (десктоп — до 30 минут).
    crate::notify::wake_scheduler();
    Ok(task)
}

/// INSERT/UPDATE задачи — единый для upsert_task и duplicate_task (19 колонок
/// в одном месте; расхождение списка с TASK_COLUMNS ловит тест в db.rs).
pub(crate) fn write_task(conn: &rusqlite::Connection, task: &Task) -> Result<(), String> {
    conn.execute(
        &format!(
            "INSERT INTO tasks ({TASK_COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title, date=excluded.date, is_done=excluded.is_done,
               color_set_id=excluded.color_set_id, sort_order=excluded.sort_order,
               updated_at=excluded.updated_at, device_id=excluded.device_id,
               time_minutes=excluded.time_minutes, notes=excluded.notes,
               someday=excluded.someday, archived=excluded.archived,
               travel_time=excluded.travel_time, duration_minutes=excluded.duration_minutes,
               difficulty=excluded.difficulty, notify_minutes=excluded.notify_minutes,
               travel_notify_minutes=excluded.travel_notify_minutes,
               due_epoch_day=excluded.due_epoch_day",
        ),
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
            task.travel_notify_minutes,
            task.due_epoch_day,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Дублировать задачу: полная копия с новым id — время, длительность,
/// напоминание, выезд, приоритет, категория, заметка, срок «Когда-нибудь»
/// и подзадачи (невыполненными). Выполненность и архив у копии сняты.
///
/// Проверка наложений ПРОПУЩЕНА сознательно: копия создаётся в тот же слот,
/// что и оригинал (иначе клон задачи 10:00–11:00 всегда падал бы с «Время
/// занято задачей …» и фича была бы бесполезна как раз для задач со временем).
/// Пользователь разнесёт копии сам — либо это и было целью (повтор дела).
/// Вложения (файлы) не копируются — только подзадачи.
/// Напоминания копии заводятся сами: wake_scheduler → планировщик увидит
/// новую задачу со временем и поставит будильники (оповещение дублируется
/// вместе с задачей).
#[tauri::command]
pub fn duplicate_task(state: State<'_, Db>, id: String) -> Result<Task, String> {
    let mut conn = state.lock();
    let copy = duplicate_task_conn(&mut conn, &id)?;
    crate::notify::wake_scheduler();
    Ok(copy)
}

/// Ядро дублирования (без State — вызывается командой и юнит-тестом).
/// Транзакция: копия задачи + её подзадачи атомарно — сбой на середине не
/// оставит задачу без подзадач или подзадачи без задачи.
pub(crate) fn duplicate_task_conn(
    conn: &mut rusqlite::Connection,
    id: &str,
) -> Result<Task, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let orig = select_task_by_id(&tx, id)?.ok_or("Задача не найдена")?;
    let subs = select_subtasks(&tx, id)?;
    let mut copy = orig;
    copy.id = Uuid::new_v4().to_string();
    copy.is_done = false;
    copy.archived = false;
    copy.created_at = now_ms();
    copy.updated_at = now_ms();
    // Сортировка «сейчас» (как Date.now() на фронте у новых задач): копия
    // встаёт сразу после оригинала в тот же слот времени.
    copy.sort_order = now_ms() as f64;
    write_task(&tx, &copy)?;
    for s in subs {
        tx.execute(
            "INSERT INTO subtasks (id, task_id, title, is_done, sort_order, created_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?5)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                copy.id,
                s.title,
                s.sort_order,
                now_ms()
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(copy)
}

/// Привести поля задачи к допустимым диапазонам. Граница доверия: значения
/// приходят из webview и из файла бэкапа, а логика опирается на эти границы —
/// время 0..1439 (иначе врут наложения, напоминания и формат «ЧЧ:ММ»),
/// сложность 0..3 (иначе чипы приоритета рендерятся пустыми), длительности
/// неотрицательны и не больше UI-потолка (168 ч), интервал напоминания
/// не больше 30 дней.
fn sanitize_task(task: &mut Task) {
    task.time_minutes = task.time_minutes.map(|m| m.clamp(0, 1439));
    task.duration_minutes = task.duration_minutes.map(|d| d.clamp(0, 10_080));
    task.travel_time = task.travel_time.map(|t| t.clamp(0, 10_080));
    task.travel_notify_minutes = task.travel_notify_minutes.map(|t| t.clamp(0, 10_080));
    task.notify_minutes = task.notify_minutes.map(|n| n.clamp(0, 43_200));
    task.difficulty = task.difficulty.clamp(0, 3);
    task.due_epoch_day = task.due_epoch_day.map(|d| d.clamp(-719_162, 2_932_896));
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
    // У задачи могли быть запланированные напоминания — пересчитываем сразу.
    crate::notify::wake_scheduler();
    Ok(())
}

#[tauri::command]
pub fn move_task(state: State<'_, Db>, id: String, new_date: i64) -> Result<(), String> {
    let conn = state.lock();
    // Запрет наложений действует и при переносе: читаем задачу, подставляем
    // новую дату и проверяем пересечение (как при сохранении времени).
    let task = select_task_by_id(&conn, &id)?;
    let Some(task) = task else {
        return Ok(()); // задачи нет — идемпотентно
    };
    // План-задача («Когда-нибудь» с мягким сроком): перенос в ячейку дня меняет
    // её мягкий срок (дедлайн переезжает на этот день), но задача остаётся
    // план-задачей «В течение недели/месяца» — не превращается в обычную
    // дневную (иначе она «выпадала» бы из план-группы при переносе).
    if task.someday {
        conn.execute(
            "UPDATE tasks SET due_epoch_day = ?1, date = 0, archived = 0, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![new_date, now_ms(), id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    if !task.someday && !task.archived && !task.is_done && task.time_minutes.is_some() {
        let mut moved = task.clone();
        moved.date = new_date;
        check_time_overlap(&conn, &moved)?;
    }
    // Перенос в прошлое = задача закрыта (выполнена); перенос в будущее из
    // прошлого = снова актуальна (не выполнена). Сегодня не трогаем.
    move_task_to_date(&conn, &id, new_date)?;
    crate::notify::wake_scheduler();
    Ok(())
}

/// Задачи «Когда-нибудь» — без привязки ко дню.
#[tauri::command]
pub fn get_someday_tasks(state: State<'_, Db>) -> Result<Vec<Task>, String> {
    let conn = state.lock();
    select_tasks(
        &conn,
        "WHERE someday = 1 AND archived = 0 ORDER BY (due_epoch_day IS NULL) ASC, due_epoch_day ASC, sort_order ASC, created_at ASC",
        &[],
    )
}

/// Переместить задачу в «Когда-нибудь» (дата и мягкий срок сбрасываются —
/// перенос из план-группы «Неделя/Месяц» снимает привязку к дедлайну).
#[tauri::command]
pub fn set_someday(state: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = state.lock();
    conn.execute(
        "UPDATE tasks SET someday = 1, date = 0, due_epoch_day = NULL, archived = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now_ms(), id],
    )
    .map_err(|e| e.to_string())?;
    crate::notify::wake_scheduler();
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
    if count > 0 {
        crate::notify::wake_scheduler();
    }
    Ok(count)
}

/// Задачи «Архива» — скрытые из видов, ждут возврата на дату.
#[tauri::command]
pub fn get_archived_tasks(state: State<'_, Db>) -> Result<Vec<Task>, String> {
    let conn = state.lock();
    select_tasks(
        &conn,
        "WHERE archived = 1 ORDER BY date DESC, updated_at DESC",
        &[],
    )
}

/// Вернуть задачу из «Архива» на выбранную дату (archived снимается).
#[tauri::command]
pub fn restore_archived(state: State<'_, Db>, id: String, date: i64) -> Result<(), String> {
    let conn = state.lock();
    // Запрет наложений действует и при возврате из архива: проверяем время
    // восстановленной задачи на целевой дате (как при переносе).
    let task = select_task_by_id(&conn, &id)?;
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
    move_task_to_date(&conn, &id, date)?;
    crate::notify::wake_scheduler();
    Ok(())
}

// ── Подзадачи ───────────────────────────────────────────────────────

/// Подзадачи задачи (общее для get_subtasks и duplicate_task).
fn select_subtasks(conn: &rusqlite::Connection, task_id: &str) -> Result<Vec<Subtask>, String> {
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
pub fn get_subtasks(state: State<'_, Db>, task_id: String) -> Result<Vec<Subtask>, String> {
    let conn = state.lock();
    select_subtasks(&conn, &task_id)
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

/// Экспорт всех данных JSON-строкой (ручной экспорт на Android пишет файл
/// плагином fs — системные диалоги там возвращают content:// из плагина;
/// на десктопе файл пишет export_backup напрямую, см. ниже).
#[tauri::command]
pub fn export_json(app: tauri::AppHandle, state: State<'_, Db>) -> Result<String, String> {
    let conn = state.lock();
    export_to_string(&conn, &attachments_dir(&app))
}

/// Ручной экспорт (десктоп): путь выбирает системный диалог НА СТОРОНЕ Rust,
/// файл пишет Rust — вебвью не получает прав на запись в произвольное место.
/// Раньше запись делал tauri-plugin-fs с правом fs:write-files по $HOME/**,
/// из-за чего компрометация рендерера давала чтение/запись любого файла
/// домашнего каталога. Пустая строка — пользователь отменил диалог.
///
/// Команда async: sync-команды выполняются на главном потоке, а диалог
/// отвечает тоже с главного — блокирующее ожидание там дало бы вечный дедлок.
#[tauri::command]
pub async fn export_backup(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let date = chrono::Local::now().date_naive();
    app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(format!("daily-planner-backup-{date}.json"))
        .save_file(move |p| {
            let _ = tx.send(p);
        });
    let Some(picked) = rx.recv().map_err(|e| e.to_string())? else {
        return Ok(String::new());
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let json = export_json(app.clone(), app.state::<Db>())?;
    write_atomic(&path, json.as_bytes())?;
    Ok(path.display().to_string())
}

/// Ручной импорт (десктоп): путь выбирает системный диалог на стороне Rust.
/// Ok(None) — диалог отменён.
#[tauri::command]
pub async fn import_backup(
    app: tauri::AppHandle,
    state: State<'_, Db>,
) -> Result<Option<usize>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let Some(picked) = rx.recv().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let json =
        std::fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    // Разбор и декод base64 — до блокировки БД (см. import_json).
    let prepared = prepare_import(&json)?;
    let mut conn = state.lock();
    let n = apply_import(&mut conn, &attachments_dir(&app), &prepared)?;
    crate::notify::wake_scheduler();
    Ok(Some(n))
}

/// Сериализация данных в JSON-бэкап (без State — для тестов). Формат:
/// version 2 + colorSets/tasks/subtasks/attachments. Маппинг колонок —
/// через структуры моделей (TASK_COLUMNS/task_from_row), а не второй список.
fn export_to_string(
    conn: &rusqlite::Connection,
    files_dir: &std::path::Path,
) -> Result<String, String> {
    let sets: Vec<ColorSet> = {
        let mut stmt = conn
            .prepare("SELECT id, name, color, sort_order FROM color_sets ORDER BY sort_order ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ColorSet {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    sort_order: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    let tasks = select_tasks(conn, "ORDER BY sort_order ASC", &[])?;
    let subs: Vec<Subtask> = {
        let mut stmt = conn
            .prepare("SELECT id, task_id, title, is_done, sort_order, created_at FROM subtasks ORDER BY sort_order ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Subtask {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    title: r.get(2)?,
                    is_done: r.get(3)?,
                    sort_order: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };

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
            let data = std::fs::read(files_dir.join(&stored_name)).ok();
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

    let mut payload = serde_json::json!({
        "version": 2,
        "exportedAt": 0i64,
        "colorSets": sets,
        "tasks": tasks,
        "subtasks": subs,
        "attachments": atts,
    });
    // Хеш содержимого (без метки времени): автоэкспорт сравнивает его с прошлым
    // и не переписывает файл без изменений — иначе каждая правка гоняла бы
    // multi-МБ JSON с base64 вложений, а после импорта на другом устройстве
    // экспорты пошли бы по кругу (импорт тоже вызывает перезагрузку данных).
    payload["contentHash"] = serde_json::json!(fnv64(payload.to_string().as_bytes()));
    payload["exportedAt"] = serde_json::json!(chrono::Utc::now().timestamp_millis());
    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
}

/// FNV-1a 64-bit — быстрый хеш содержимого экспорта (сравнение, не безопасность).
pub(crate) fn fnv64(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in data {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Структура бэкапа для импорта. Массивы задач/категорий/подзадач
/// десериализуются в модели (недостающие поля — дефолты, лишние
/// игнорируются); вложения остаются сырыми JSON — их полей (storedName,
/// base64) нет в моделях.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupDoc {
    #[serde(default)]
    color_sets: Vec<ColorSet>,
    tasks: Vec<Task>,
    #[serde(default)]
    subtasks: Vec<Subtask>,
    #[serde(default)]
    attachments: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn import_json(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    json: String,
) -> Result<usize, String> {
    // Декод base64 вложений (десятки МБ) — ДО блокировки БД: иначе интерфейс
    // стоял секунды на большом бэкапе (мьютекс держал все команды).
    let prepared = prepare_import(&json)?;
    let mut conn = state.lock();
    let n = apply_import(&mut conn, &attachments_dir(&app), &prepared)?;
    crate::notify::wake_scheduler();
    Ok(n)
}

/// Импорт данных из JSON-строки (полная замена в транзакции: при ошибке —
/// откат, старые данные остаются). Отсутствующие поля берутся как дефолты,
/// лишние/неизвестные поля игнорируются. Версии бэкапа: 1 (без вложений) и
/// 2 (с вложениями). Обёртка «разбор + запись» — только для тестов.
#[cfg(test)]
fn import_from_string(
    conn: &mut rusqlite::Connection,
    files_dir: &std::path::Path,
    json: &str,
) -> Result<usize, String> {
    let prepared = prepare_import(json)?;
    apply_import(conn, files_dir, &prepared)
}

/// Вложение бэкапа, уже декодированное из base64 (БД и диск не трогает).
struct PreparedAttachment {
    id: String,
    task_id: String,
    file_name: String,
    mime: String,
    size: i64,
    stored_name: String,
    created_at: i64,
    data: Vec<u8>,
}

/// Разобранный бэкап: проверки и декод base64 выполнены без блокировки БД.
struct PreparedImport {
    color_sets: Vec<ColorSet>,
    tasks: Vec<Task>,
    subtasks: Vec<Subtask>,
    attachments: Vec<PreparedAttachment>,
}

/// Имя файла вложения из бэкапа: ровно «основа.расширение», части непустые.
/// Прежний фильтр («алфавитно-цифровые и точка») пропускал имена из одних
/// точек: `..` давал запись в родительский каталог (EISDIR) и импорт падал
/// целиком вместо отказа от одного вложения.
fn valid_stored_name(name: &str) -> bool {
    let mut parts = name.split('.');
    let (Some(base), Some(ext), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !base.is_empty()
        && !ext.is_empty()
        && base.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Разбор бэкапа: версия, лимиты, декод вложений. Без БД и диска.
fn prepare_import(json: &str) -> Result<PreparedImport, String> {
    // Защита от гигантских payload: 100 МБ строки достаточно для бэкапа
    // личного планировщика (включая вложения до 25 МБ каждое).
    if json.len() > 100 * 1024 * 1024 {
        return Err("Файл бэкапа больше 100 МБ".to_string());
    }
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    // Строгая проверка версии: отсутствие поля или не-целое значение
    // (например, float 1.5) дают unwrap_or(0) → ошибка.
    let version = v.get("version").and_then(|x| x.as_i64()).unwrap_or(0);
    if version != 1 && version != 2 {
        return Err("Неподдерживаемая версия бэкапа".to_string());
    }
    let mut doc: BackupDoc =
        serde_json::from_value(v).map_err(|e| format!("Бэкап не читается: {e}"))?;
    // Ограничение числа элементов: 100k задач больше чем достаточно.
    if doc.tasks.len() > 100_000 {
        return Err("Слишком много задач в бэкапе".to_string());
    }
    // Бэкап — тоже граница доверия (файл мог быть отредактирован вручную).
    for t in &mut doc.tasks {
        sanitize_task(t);
    }

    // Вложения (версия бэкапа 2): base64 → байты. Файла в бэкапе нет (v1) —
    // вложение пропускаем, осиротевший файл на диске почистит apply_import.
    let mut attachments = Vec::new();
    for a in &doc.attachments {
        let stored = a.get("storedName").and_then(|x| x.as_str()).unwrap_or("");
        let Some(b64) = a.get("base64").and_then(|x| x.as_str()) else {
            continue;
        };
        if !valid_stored_name(stored) {
            continue;
        }
        let data =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64.as_bytes())
                .map_err(|e| format!("Не удалось декодировать вложение: {e}"))?;
        if data.is_empty() {
            continue;
        }
        attachments.push(PreparedAttachment {
            id: a
                .get("id")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            task_id: a
                .get("taskId")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            file_name: a
                .get("fileName")
                .and_then(|x| x.as_str())
                .unwrap_or("file")
                .to_string(),
            mime: a
                .get("mime")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            size: a
                .get("size")
                .and_then(|x| x.as_i64())
                .unwrap_or(data.len() as i64),
            stored_name: stored.to_string(),
            created_at: a.get("createdAt").and_then(|x| x.as_i64()).unwrap_or(0),
            data,
        });
    }
    Ok(PreparedImport {
        color_sets: doc.color_sets,
        tasks: doc.tasks,
        subtasks: doc.subtasks,
        attachments,
    })
}

/// Записать разобранный бэкап: полная замена в одной транзакции. Файлы
/// вложений пишем ДО commit (сбой записи откатывает транзакцию целиком), а
/// написанное в этом импорте удаляем в ветке ошибки — раньше такие файлы
/// оставались на диске сиротами навсегда.
fn apply_import(
    conn: &mut rusqlite::Connection,
    files_dir: &std::path::Path,
    p: &PreparedImport,
) -> Result<usize, String> {
    // conn — &mut Connection, поэтому обычная transaction()
    // (unchecked_transaction не нужен: активных prepared-стейтментов нет).
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

    for s in &p.color_sets {
        tx.execute(
            "INSERT INTO color_sets (id, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![s.id, s.name, s.color, s.sort_order],
        )
        .map_err(|e| e.to_string())?;
    }
    for t in &p.tasks {
        tx.execute(
            &format!(
                "INSERT INTO tasks ({TASK_COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            ),
            rusqlite::params![
                t.id, t.title, t.date, t.is_done as i64, t.color_set_id, t.sort_order,
                t.created_at, t.updated_at, t.device_id, t.time_minutes, t.notes,
                t.someday as i64, t.archived as i64, t.travel_time, t.duration_minutes,
                t.difficulty, t.notify_minutes, t.travel_notify_minutes, t.due_epoch_day
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for s in &p.subtasks {
        tx.execute(
            "INSERT INTO subtasks (id, task_id, title, is_done, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![s.id, s.task_id, s.title, s.is_done as i64, s.sort_order, s.created_at],
        )
        .map_err(|e| e.to_string())?;
    }
    // Вложения: файл на диск + строка в БД. Пишем до commit, а при сбое
    // удаляем написанное в этом импорте (иначе — осиротевшие файлы навсегда).
    let new_files: std::collections::HashSet<&str> = p
        .attachments
        .iter()
        .map(|a| a.stored_name.as_str())
        .collect();
    std::fs::create_dir_all(files_dir).map_err(|e| e.to_string())?;
    let mut written: Vec<&str> = Vec::new();
    let files_result = (|| -> Result<(), String> {
        for a in &p.attachments {
            std::fs::write(files_dir.join(&a.stored_name), &a.data)
                .map_err(|e| format!("Не удалось записать вложение: {e}"))?;
            written.push(a.stored_name.as_str());
            tx.execute(
                "INSERT INTO attachments (id, task_id, file_name, mime, size, stored_name, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    a.id,
                    a.task_id,
                    a.file_name,
                    a.mime,
                    a.size,
                    a.stored_name,
                    a.created_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if let Err(e) = files_result {
        for f in written {
            let _ = std::fs::remove_file(files_dir.join(f));
        }
        return Err(e); // транзакция откатится при drop
    }
    tx.commit().map_err(|e| e.to_string())?;
    // Чистка сирот: файлы старых вложений, не вошедшие в новый набор.
    for f in old_files {
        if !new_files.contains(f.as_str()) {
            let _ = std::fs::remove_file(files_dir.join(f));
        }
    }
    Ok(p.tasks.len())
}

/// Закрывает приложение (системная кнопка «назад» на Android, кнопка «Выйти»
/// в настройках на десктопе).
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Свернуть приложение на Android (кнопка «назад» при закрытых модалках):
/// задача уходит в фон, процесс остаётся жив — следующий запуск из лончера
/// тёплый (WebView уже создан), без холодного экрана. На десктопе no-op.
/// Асинхронно: sync-версия run_mobile_plugin блокирует поток до ответа
/// главного потока Android (см. write_widget_data — там дедлок).
#[tauri::command]
#[cfg_attr(not(target_os = "android"), allow(unused_variables))]
pub fn minimize_app(app: tauri::AppHandle) {
    #[cfg(target_os = "android")]
    if let Some(state) = app.try_state::<crate::WidgetPush>() {
        if let Some(handle) = &state.0 {
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                let _ = h.run_mobile_plugin_async::<()>("minimize", ()).await;
            });
        }
    }
}

/// Метка этапа холодного старта — в кольцевой журнал диагностики. Фронтенд
/// отмечает «tasks-loaded»; по журналу после жалобы «не запустилось с первого
/// раза» видно, докуда дошёл старт (нет записи «старт» — процесс не
/// поднимался, записи обрываются — завис на конкретном этапе).
#[tauri::command]
pub fn startup_milestone(name: String) {
    core_base::diagnostics::record(format!("start: {name}"));
}

/// Имя файла автосинхронизации. Имя фиксирует Rust, а фронтенд передаёт
/// только ПАПКУ (выбранную системным диалогом): задать произвольный путь из
/// webview невозможно даже при компрометации рендерера. Раньше команды
/// принимали полный путь и проверяли лишь имя файла — symlink с тем же именем
/// в любом каталоге проверку обходил.
const SYNC_FILE_NAME: &str = "daily-planner-sync.json";

/// Путь файла автосинхронизации: <папка>/<SYNC_FILE_NAME>.
fn sync_file_path(dir: &str) -> Result<std::path::PathBuf, String> {
    let d = std::path::Path::new(dir);
    if !d.is_dir() {
        return Err(format!("Папка синхронизации не найдена: {dir}"));
    }
    Ok(d.join(SYNC_FILE_NAME))
}

/// Атомарная запись файла: временный файл в той же папке + rename. Обрыв
/// (сбой питания/процесса) не оставит оборванный JSON, который импорт молча
/// пропускал бы, — канал синхронизации «умирал» бы тихо.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Не удалось сохранить файл: {e}")
    })
}

/// Прочитать файл автосинхронизации из папки `dir`. Ok(None) — файла нет
/// (норма), Ok(Some) — содержимое, Err — файл есть, но не читается (папка
/// отозвана/перемещена): фронт отличает это от «файла нет» и сообщает
/// пользователю, а не выключает автоимпорт молча навсегда.
#[tauri::command]
pub fn read_sync_file(dir: String) -> Result<Option<String>, String> {
    let path = sync_file_path(&dir)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Файл синхронизации не читается: {e}")),
    }
}

/// Записать файл автосинхронизации в папку `dir`. На Android не используется:
/// content:// из системных диалогов std::fs не понимает (там — ручной экспорт).
#[tauri::command]
pub fn write_sync_file(dir: String, content: String) -> Result<(), String> {
    let path = sync_file_path(&dir)?;
    write_atomic(&path, content.as_bytes())
}

/// Сохранить настройки уведомлений (планировщик подхватит сразу: сохранение
/// будит его на пересчёт расписания пробуждений).
#[tauri::command]
pub fn set_notification_prefs(
    app: tauri::AppHandle,
    mut prefs: crate::notify::NotifyPrefs,
) -> Result<(), String> {
    // Диапазоны проверяем и здесь: значение приходит из webview, а битый
    // час/интервал раньше молча ломал дайджест и напоминания (час вне 0..23 →
    // дайджест не приходил никогда).
    crate::notify::sanitize_prefs(&mut prefs);
    let res = crate::notify::save_prefs(&app, &prefs);
    // Будим на обеих платформах: настройка меняется редко, а мгновенная
    // пересинхронизация (Android — sync_scheduled, десктоп — next_wake_in)
    // лучше ожидания следующего тика.
    crate::notify::wake_scheduler();
    res
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
    // Изменение задач может двигать ближайшее напоминание — будим планировщик
    // пересчитать расписание (фронтенд зовёт эту команду после каждой правки
    // задач через дебаунс, всплеск коаллесится в один wake). На Android это
    // мгновенно синхронизирует OS-планировщик с изменениями (раньше — до
    // 60 с ожидания тика), на десктопе — пересчитывает момент пробуждения.
    crate::notify::wake_scheduler();
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

/// Каталог data-файлов: на Android — app_data_dir/files (там читает Kotlin-
/// виджет через context.filesDir), на десктопе — сам app_data_dir.
#[cfg_attr(not(target_os = "android"), allow(unused_mut))]
fn app_files_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let mut dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            // Каталог данных недоступен (экзотика) — работаем в текущем каталоге,
            // но громко: иначе виджет молча пустой, а файлы уезжают неизвестно куда.
            eprintln!("[daily-planner] app_data_dir недоступен ({e}), файлы — в текущем каталоге");
            std::path::PathBuf::from(".")
        }
    };
    #[cfg(target_os = "android")]
    {
        dir = dir.join("files");
    }
    dir
}

/// Тема (dark), сохранённая в последнем widget.json. Планировщик перезаписывает
/// файл при смене дня и не должен сбрасывать тему на светлую — берём её из
/// предыдущей записи.
pub fn read_widget_dark(app: &tauri::AppHandle) -> bool {
    let raw = std::fs::read_to_string(app_files_dir(app).join("widget.json")).unwrap_or_default();
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
    // Строка виджета: одна для всех выборок, отличается только LIMIT (?2).
    // Порядок — как просил пользователь: сначала задачи С временем (по времени),
    // затем без времени по приоритету (difficulty), tie-break — ручной порядок.
    const WIDGET_TASK_SQL: &str = "SELECT id, title, time_minutes, is_done FROM tasks WHERE date = ?1 AND archived = 0 AND someday = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT ?2";
    let query_by_day =
        |conn: &rusqlite::Connection, day: i64, limit: i64| -> Vec<serde_json::Value> {
            conn.prepare(WIDGET_TASK_SQL)
                .and_then(|mut stmt| {
                    stmt.query_map([day, limit], task_row)
                        .and_then(|it| it.collect::<Result<Vec<_>, _>>())
                })
                .unwrap_or_else(|e| {
                    // Ошибку SQL не глотаем: иначе виджет молча показывает
                    // пустой день вместо данных.
                    eprintln!("[widget] выборка задач дня не удалась: {e}");
                    Vec::new()
                })
        };
    // Окно дней для интерактивного виджета «День»: вчера..+13 (задачи,
    // добавленные через «Другая дата», тоже видны), до 8 задач на день.
    // Стрелки ‹ › в виджете переключают день без захода в приложение.
    let day_window: Vec<serde_json::Value> = (-1..=13)
        .map(|off| {
            let day = today + off;
            let day_tasks = query_by_day(&conn, day, 8);
            serde_json::json!({ "date": day, "tasks": day_tasks })
        })
        .collect();
    let tasks = day_window[1]["tasks"].clone();
    // Сегодня и неделя — срезы того же окна: ORDER BY одинаков, поэтому
    // первые K строк выборки LIMIT 8 = выборка LIMIT K. Экономит 8 запросов.
    let week: Vec<serde_json::Value> = day_window[1..8]
        .iter()
        .map(|d| {
            let mut w = d.clone();
            if let Some(arr) = w.get_mut("tasks").and_then(|t| t.as_array_mut()) {
                arr.truncate(4);
            }
            w
        })
        .collect();
    // «Когда-нибудь» — задачи без даты, до 8 (без параметров).
    let someday: Vec<serde_json::Value> = conn
        .prepare("SELECT id, title, time_minutes, is_done FROM tasks WHERE someday = 1 AND archived = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 8")
        .and_then(|mut stmt| stmt.query_map([], task_row).and_then(|it| it.collect::<Result<Vec<_>, _>>()))
        .unwrap_or_default();
    let payload = serde_json::json!({
        "date": today,
        "tasks": tasks,
        "week": week,
        "someday": someday,
        "dayWindow": day_window,
        "dark": dark,
    });
    // На Android каталог data-файлов — data/files; на десктопе dir не меняется.
    let dir = app_files_dir(app);
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
    // Обход каталога — до взятия мьютекса: сканирование не должно блокировать
    // запросы UI (на старте они идут сразу после показа окна).
    let files: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    if files.is_empty() {
        return;
    }
    // Имена «живых» вложений одним запросом: COUNT на каждый файл — это N
    // подготовок SQL и N обращений к БД под тем же мьютексом.
    let known: std::collections::HashSet<String> = {
        let conn = state.lock();
        let Ok(mut stmt) = conn.prepare("SELECT stored_name FROM attachments") else {
            return;
        };
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    };
    for name in files {
        if known.contains(&name) {
            continue;
        }
        let path = dir.join(&name);
        if let Err(e) = std::fs::remove_file(&path) {
            eprintln!(
                "[attachments] не удалось удалить сироту {}: {e}",
                path.display()
            );
        }
    }
}

// ── Вложения заметок (файлы) ──────────────────────────────────────────

/// Каталог вложений: на Android app_data_dir/files/attachments (там же, где
/// widget.json — context.filesDir), на десктопе — app_data_dir/attachments.
fn attachments_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app_files_dir(app).join("attachments")
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
    // INSERT (FK) файл остался бы сиротой на диске. Блокировку держим только
    // на проверку: запись 25 МБ на диск не должна останавливать запросы UI.
    {
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
    let conn = state.lock();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open;

    /// Временный каталог вложений для тестов (создаётся, чистится в конце).
    fn test_files_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dp_test_files_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("создать временный каталог вложений");
        dir
    }

    /// Отдельный пустой каталог для теста, проверяющего СОДЕРЖИМОЕ каталога:
    /// общий test_files_dir делят параллельные тесты, счёт файлов в нём врёт.
    fn unique_files_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dp_test_{tag}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("создать временный каталог");
        dir
    }

    /// Экспорт → импорт в чистую БД: данные не теряются (включая новые поля).
    #[test]
    fn export_import_roundtrip() {
        let conn = open(":memory:").expect("open test db");
        conn.execute(
            "INSERT INTO color_sets (id, name, color, sort_order) VALUES ('cs1', 'Работа', 4291405948, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            &format!(
                "INSERT INTO tasks ({TASK_COLUMNS})
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)"
            ),
            rusqlite::params![
                "t1",
                "Задача",
                20_000,
                0,
                Some("cs1"),
                1.0,
                1000,
                1000,
                "dev",
                Some(600),
                "заметка",
                1,
                0,
                None::<i32>,
                Some(30),
                2,
                Some(15),
                Some(10),
                Some(20_010)
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO subtasks (id, task_id, title, is_done, sort_order, created_at)
             VALUES ('s1', 't1', 'Подзадача', 1, 1.0, 1000)",
            [],
        )
        .unwrap();

        let dir = test_files_dir();
        let json = export_to_string(&conn, &dir).expect("export");
        let v: serde_json::Value = serde_json::from_str(&json).expect("json");
        assert_eq!(v["version"], 2);
        assert_eq!(v["tasks"][0]["notes"], "заметка");
        assert_eq!(v["tasks"][0]["isDone"], false);

        let mut conn2 = open(":memory:").expect("open second db");
        let n = import_from_string(&mut conn2, &dir, &json).expect("import");
        assert_eq!(n, 1);
        let task = select_task_by_id(&conn2, "t1")
            .expect("select")
            .expect("task exists");
        assert_eq!(task.title, "Задача");
        assert_eq!(task.notes, "заметка");
        assert!(task.someday);
        assert_eq!(task.difficulty, 2);
        assert_eq!(task.time_minutes, Some(600));
        assert_eq!(task.color_set_id.as_deref(), Some("cs1"));
        let subs: i64 = conn2
            .query_row(
                "SELECT COUNT(*) FROM subtasks WHERE task_id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(subs, 1);
        let sets: i64 = conn2
            .query_row(
                "SELECT COUNT(*) FROM color_sets WHERE id = 'cs1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sets, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Старый бэкап (v1, без notes/someday/archived) импортируется с дефолтами.
    #[test]
    fn import_accepts_old_backup_without_new_fields() {
        let mut conn = open(":memory:").expect("open test db");
        let json = r#"{
            "version": 1,
            "colorSets": [{"id": "cs1", "name": "Работа", "color": 4291405948, "sortOrder": 1}],
            "tasks": [{"id": "t1", "title": "Старая", "date": 20000, "isDone": true,
                       "colorSetId": "cs1", "sortOrder": 1.0, "createdAt": 1000,
                       "updatedAt": 1000, "deviceId": "dev", "timeMinutes": null}],
            "subtasks": []
        }"#;
        let dir = test_files_dir();
        let n = import_from_string(&mut conn, &dir, json).expect("import old backup");
        assert_eq!(n, 1);
        let task = select_task_by_id(&conn, "t1")
            .expect("select")
            .expect("task");
        assert_eq!(task.notes, "", "старый бэкап без notes → ''");
        assert!(!task.someday);
        assert!(!task.archived);
        assert!(task.is_done);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Неверная версия бэкапа отклоняется до разбора содержимого.
    #[test]
    fn import_rejects_unknown_version() {
        let mut conn = open(":memory:").expect("open test db");
        let dir = test_files_dir();
        let err = import_from_string(&mut conn, &dir, r#"{"version": 99, "tasks": []}"#)
            .expect_err("должна быть ошибка версии");
        assert!(err.contains("Неподдерживаемая версия"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Прямое/обратное преобразование дата ↔ epoch-day согласовано (включая даты до 1970).
    #[test]
    fn date_epoch_roundtrip() {
        let d = NaiveDate::from_ymd_opt(2026, 8, 16).unwrap();
        let ed = date_to_epoch(d);
        assert_eq!(epoch_to_date(ed), Some(d));

        // Даты до 1970 (отрицательный epoch day)
        let past = NaiveDate::from_ymd_opt(1965, 3, 15).unwrap();
        let past_ed = date_to_epoch(past);
        assert!(past_ed < 0);
        assert_eq!(epoch_to_date(past_ed), Some(past));

        assert_eq!(
            today_epoch_day(),
            date_to_epoch(chrono::Local::now().date_naive())
        );
    }

    /// Имя файла вложения из бэкапа — граница безопасности: путь собирается из
    /// этого имени, поэтому пропускаем только «основа.расширение» без путей,
    /// точек-обманок и лишних разделителей.
    #[test]
    fn stored_name_validation() {
        assert!(valid_stored_name(
            "3f2a1b4c-9d8e-4f0a-b1c2-3456789abcde.png"
        ));
        assert!(valid_stored_name("file.pdf"));
        assert!(!valid_stored_name(".."));
        assert!(!valid_stored_name("."));
        assert!(!valid_stored_name(".hidden"));
        assert!(!valid_stored_name("a.b.c"));
        assert!(!valid_stored_name("../../etc/passwd"));
        assert!(!valid_stored_name("a/b.png"));
        assert!(!valid_stored_name("noext"));
        assert!(!valid_stored_name(""));
    }

    /// Бэкап с враждебным именем вложения (имена из одних точек давали запись
    /// в родительский каталог) отбрасывает такое вложение, а не падает целиком.
    #[test]
    fn import_skips_hostile_attachment_name() {
        let dir = unique_files_dir("hostile");
        let mut conn = open(":memory:").expect("open test db");
        let json = r#"{"version":2,"tasks":[],"attachments":[{"id":"a1","taskId":"t1","fileName":"x","storedName":"..","base64":"aGk="}]}"#;
        let n = import_from_string(&mut conn, &dir, json).expect("import");
        assert_eq!(n, 0);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))
            .expect("count");
        assert_eq!(count, 0, "враждебное вложение не должно попасть в БД");
        let left = std::fs::read_dir(&dir).expect("read dir").count();
        assert_eq!(left, 0, "импорт не должен писать файлы по такому имени");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Путь файла синхронизации: имя фиксирует Rust, чужая/несуществующая
    /// папка не проходит.
    #[test]
    fn sync_file_path_is_pinned() {
        let dir = unique_files_dir("sync");
        let p = sync_file_path(dir.to_str().expect("path")).expect("path");
        assert_eq!(p.file_name().and_then(|n| n.to_str()), Some(SYNC_FILE_NAME));
        assert!(sync_file_path("/no/such/dir/anywhere").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
