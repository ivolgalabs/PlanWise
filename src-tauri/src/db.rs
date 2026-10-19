use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Состояние БД, доступное Tauri-командам через State<Db>.
pub struct Db(pub Mutex<Connection>);

impl Db {
    /// Безопасный захват соединения: даже если мьютекс «отравлен» паникой
    /// другого потока, берём данные как есть (into_inner) вместо повторной
    /// паники на каждом вызове — одна ошибка не убивает все команды.
    pub fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

use refinery::embed_migrations;
embed_migrations!("migrations");

/// Открывает SQLite по пути и прогоняет миграции (refinery).
/// Вынесено из init, чтобы тесты могли открывать in-memory БД.
/// Возвращает понятную ошибку вместо паники — при сбое БД (read-only каталог,
/// коррупция, ошибка миграции) приложение закроется с сообщением, а не молча.
pub fn open(path: impl AsRef<std::path::Path>) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| format!("не удалось открыть БД: {e}"))?;

    // Включаем WAL для лучшей конкурентности и быстродействия.
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    // Внешние ключи: subtasks ссылаются на tasks — каскадная согласованность.
    conn.pragma_update(None, "foreign_keys", "ON").ok();
    // Если другой поток/процесс держит транзакцию дольше мгновения — ждём
    // до 5 секунд вместо мгновенной ошибки SQLITE_BUSY.
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();

    migrations::runner()
        .run(&mut conn)
        .map_err(|e| format!("ошибка миграций БД: {e}"))?;

    Ok(conn)
}

/// Инициализирует SQLite в app_data_dir и прогоняет миграции (refinery).
pub fn init(app: &AppHandle) -> Result<Mutex<Connection>, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("недоступен каталог данных: {e}"))?;
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("не удалось создать каталог данных: {e}"))?;
    let db_path = app_dir.join("daily_planner.sqlite");
    Ok(Mutex::new(open(db_path)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Миграции применяются к in-memory БД, и у tasks есть колонка notes
    /// с default '' (фича «Заметки»).
    #[test]
    fn migrations_add_notes_column() {
        let conn = open(":memory:").expect("open test db");
        let has_notes: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'notes'",
                [],
                |row| row.get(0),
            )
            .expect("query pragma_table_info");
        assert!(
            has_notes,
            "после миграций у tasks должна быть колонка notes"
        );

        conn.execute(
            "INSERT INTO tasks (id, title, date, created_at, updated_at, device_id)
             VALUES ('t1', 'Тест', 0, 0, 0, 'dev')",
            [],
        )
        .expect("insert task");
        let notes: String = conn
            .query_row("SELECT notes FROM tasks WHERE id = 't1'", [], |row| {
                row.get(0)
            })
            .expect("select notes");
        assert_eq!(notes, "", "default notes — пустая строка");
    }

    /// Контракт: каждый столбец из TASK_COLUMNS существует в схеме tasks.
    /// Дрейф между миграциями и SELECT-списком (список — один на все команды)
    /// ломает их разом, поэтому проверяем здесь, а не на устройстве.
    /// Дублирование задачи: поля (время, длительность, напоминание, выезд)
    /// и подзадачи копируются, выполненность снята, и клон НЕ падает на
    /// проверке наложений с оригиналом (копия сознательно в тот же слот).
    #[test]
    fn duplicate_task_copies_and_allows_overlap() {
        let mut conn = open(":memory:").expect("open test db");
        let src = crate::models::Task {
            id: "src".into(),
            title: "Дела".into(),
            date: 20_000,
            is_done: true,
            time_minutes: Some(600),
            duration_minutes: Some(60),
            travel_time: Some(30),
            notify_minutes: Some(15),
            ..Default::default()
        };
        crate::commands::write_task(&conn, &src).expect("insert src");
        conn.execute(
            "INSERT INTO subtasks (id, task_id, title, is_done, sort_order, created_at)
             VALUES ('s1', 'src', 'шаг', 0, 0, 0)",
            [],
        )
        .expect("insert subtask");

        let copy = crate::commands::duplicate_task_conn(&mut conn, "src", None).expect("duplicate");
        assert_ne!(copy.id, "src");
        assert!(!copy.is_done);
        assert_eq!(copy.time_minutes, Some(600));
        assert_eq!(copy.duration_minutes, Some(60));
        assert_eq!(copy.travel_time, Some(30));
        assert_eq!(copy.notify_minutes, Some(15));
        let subs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subtasks WHERE task_id = ?1",
                [&copy.id],
                |r| r.get(0),
            )
            .expect("count subs");
        assert_eq!(subs, 1);
        let undone: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subtasks WHERE task_id = ?1 AND is_done = 0",
                [&copy.id],
                |r| r.get(0),
            )
            .expect("sub undone");
        assert_eq!(undone, 1);
    }

    #[test]
    fn task_columns_match_schema() {
        let conn = open(":memory:").expect("open test db");
        for col in crate::commands::TASK_COLUMNS.split(", ") {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = ?1",
                    [col],
                    |row| row.get(0),
                )
                .expect("pragma_table_info");
            assert!(exists, "колонки {col} из TASK_COLUMNS нет в схеме tasks");
        }
    }

    /// V5: у tasks есть колонка someday с default 0.
    #[test]
    fn migrations_add_someday_column() {
        let conn = open(":memory:").expect("open test db");
        let has: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'someday'",
                [],
                |row| row.get(0),
            )
            .expect("pragma someday");
        assert!(has, "после миграций у tasks должна быть колонка someday");
        let default: i64 = conn
            .query_row("SELECT someday FROM tasks WHERE id = 'x'", [], |row| {
                row.get(0)
            })
            .unwrap_or(0);
        assert_eq!(default, 0);
    }

    /// V15 на живой БД: закрытые до миграции задачи получают done_at = updated_at,
    /// открытые — NULL; postpone_count = 0; таблица days создана.
    #[test]
    fn v15_backfills_done_at() {
        let mut conn = Connection::open_in_memory().expect("open");
        migrations::runner()
            .set_target(refinery::Target::Version(14))
            .run(&mut conn)
            .expect("migrate to V14");
        conn.execute_batch(
            "INSERT INTO tasks (id, title, date, is_done, created_at, updated_at, device_id)
             VALUES ('d', 'done', 0, 1, 0, 777, 'dev'), ('o', 'open', 0, 0, 0, 888, 'dev');",
        )
        .expect("insert V14 rows");
        migrations::runner().run(&mut conn).expect("migrate to V15");
        let row = |id: &str| -> (Option<i64>, i64) {
            conn.query_row(
                "SELECT done_at, postpone_count FROM tasks WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("select")
        };
        assert_eq!(row("d"), (Some(777), 0));
        assert_eq!(row("o"), (None, 0));
        let days: i64 = conn
            .query_row("SELECT COUNT(*) FROM days", [], |r| r.get(0))
            .expect("days table");
        assert_eq!(days, 0);
    }

    /// V6: у tasks есть колонка archived с default 0.
    #[test]
    fn migrations_add_archived_column() {
        let conn = open(":memory:").expect("open test db");
        let has: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('tasks') WHERE name = 'archived'",
                [],
                |row| row.get(0),
            )
            .expect("pragma archived");
        assert!(has, "после миграций у tasks должна быть колонка archived");
        let default: i64 = conn
            .query_row("SELECT archived FROM tasks WHERE id = 'x'", [], |row| {
                row.get(0)
            })
            .unwrap_or(0);
        assert_eq!(default, 0);
    }
}
