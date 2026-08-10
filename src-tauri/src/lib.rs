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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Понятная ошибка вместо молчаливой паники: при сбое БД (read-only
            // каталог, коррупция) пишем причину в лог и закрываемся.
            let conn = match db::init(app.handle()) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[daily-planner] КРИТИЧЕСКАЯ ОШИБКА БАЗЫ ДАННЫХ: {e}");
                    eprintln!("[daily-planner] Приложение будет закрыто. Проверьте доступ к каталогу данных.");
                    app.handle().exit(1);
                    return Ok(());
                }
            };
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
            // Экспорт/импорт через JSON-строку: файловый ввод-вывод делает
            // tauri-plugin-fs (на Android умеет content:// из системных
            // диалогов, где std::fs не работает).
            commands::export_json,
            commands::import_json,
            // Настройки уведомлений + ручное перепланирование.
            commands::set_notification_prefs,
            commands::write_widget_data,
            // Настройки приложения (key/value) — в т.ч. запрет наложений.
            commands::get_setting,
            commands::set_setting,
            // Вложения заметок (файлы): список, добавление (base64), удаление,
            // путь для открытия системным приложением.
            commands::list_attachments,
            commands::add_attachment,
            commands::delete_attachment,
            commands::attachment_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
