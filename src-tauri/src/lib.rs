mod commands;
mod db;
mod models;
mod notify;

use db::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let conn = db::init(&app.handle());
            app.manage(Db(conn));
            // Планировщик уведомлений: утренний список задач на день и
            // напоминания за N минут до задач со временем. Пересчитывает
            // расписание при старте и при изменении настроек/задач.
            notify::start_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_tasks,
            commands::upsert_task,
            commands::delete_task,
            commands::move_task,
            commands::get_someday_tasks,
            commands::set_someday,
            commands::archive_overdue,
            commands::get_archived_tasks,
            commands::restore_archived,
            commands::get_color_sets,
            commands::upsert_color_set,
            commands::delete_color_set,
            commands::get_subtasks,
            commands::upsert_subtask,
            commands::delete_subtask,
            commands::exit_app,
            commands::export_to,

            // Экспорт/импорт через JSON-строку: файловый ввод-вывод делает
            // tauri-plugin-fs (на Android умеет content:// из системных
            // диалогов, где std::fs не работает).
            commands::export_json,
            commands::import_json,
            // Настройки уведомлений + ручное перепланирование.
            commands::set_notification_prefs,
            commands::write_widget_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
