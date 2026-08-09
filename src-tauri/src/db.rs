use core_base::fs_utils::FsUtils;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Состояние БД, доступное Tauri-командам через State<Db>.
pub struct Db(pub Mutex<Connection>);

use refinery::embed_migrations;
embed_migrations!("migrations");

/// Открывает SQLite по пути и прогоняет миграции (refinery).
/// Вынесено из init, чтобы тесты могли открывать in-memory БД.
pub fn open(path: impl AsRef<std::path::Path>) -> Connection {
    let mut conn = Connection::open(path).expect("failed to open sqlite db");

    // Включаем WAL для лучшей конкурентности и быстродействия.
    conn.pragma_update(None, "journal_mode", "WAL").ok();

    migrations::runner()
        .run(&mut conn)
        .expect("failed to run migrations");

    conn
}

/// Инициализирует SQLite в app_data_dir и прогоняет миграции (refinery).
pub fn init(app: &AppHandle) -> Mutex<Connection> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("app data dir not resolvable");
    FsUtils::ensure_dir(&app_dir).ok();
    let db_path = app_dir.join("daily_planner.sqlite");
    Mutex::new(open(db_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Миграции применяются к in-memory БД, и у tasks есть колонка notes
    /// с default '' (фича «Заметки»).
    #[test]
    fn migrations_add_notes_column() {
        let conn = open(":memory:");
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

    /// V5: у tasks есть колонка someday с default 0.
    #[test]
    fn migrations_add_someday_column() {
        let conn = open(":memory:");
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
            .query_row("SELECT archived FROM tasks WHERE id = 'x'", [], |row| {
                row.get(0)
            })
            .unwrap_or(0);
        assert_eq!(default, 0);
    }
}
