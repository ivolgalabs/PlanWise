use core_base::fs_utils::FsUtils;
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
    FsUtils::ensure_dir(&app_dir)
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
