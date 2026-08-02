use core_base::fs_utils::FsUtils;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Состояние БД, доступное Tauri-командам через State<Db>.
pub struct Db(pub Mutex<Connection>);

use refinery::embed_migrations;
embed_migrations!("migrations");

/// Инициализирует SQLite в app_data_dir и прогоняет миграции (refinery).
pub fn init(app: &AppHandle) -> Mutex<Connection> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("app data dir not resolvable");
    FsUtils::ensure_dir(&app_dir).ok();
    let db_path = app_dir.join("daily_planner.sqlite");
    let mut conn = Connection::open(db_path).expect("failed to open sqlite db");

    // Включаем WAL для лучшей конкурентности и быстродействия.
    conn.pragma_update(None, "journal_mode", "WAL").ok();

    migrations::runner()
        .run(&mut conn)
        .expect("failed to run migrations");

    Mutex::new(conn)
}
