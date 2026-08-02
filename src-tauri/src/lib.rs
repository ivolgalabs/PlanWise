mod commands;
mod db;
mod models;

use db::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let conn = db::init(&app.handle());
            app.manage(Db(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_tasks,
            commands::upsert_task,
            commands::delete_task,
            commands::move_task,
            commands::get_someday_tasks,
            commands::set_someday,
            commands::get_color_sets,
            commands::upsert_color_set,
            commands::delete_color_set,
            commands::rollover_overdue,
            commands::get_subtasks,
            commands::upsert_subtask,
            commands::delete_subtask,
            commands::export_to,
            commands::import_from,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
