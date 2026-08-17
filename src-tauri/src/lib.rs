mod commands;
mod db;
mod models;
mod notify;

use db::Db;
use tauri::Manager;
#[cfg(target_os = "android")]
use tauri_plugin_notification::NotificationExt;

/// Хендл Android-плагина виджетов (Kotlin WidgetPushPlugin). После записи
/// widget.json просим Kotlin перечитать файл и перерисовать виджеты сразу,
/// не дожидаясь системного обновления (до 30 минут). На десктопе — None.
pub struct WidgetPush(pub Option<tauri::plugin::PluginHandle<tauri::Wry>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        // Мини-плагин виджетов: регистрирует Kotlin-класс WidgetPushPlugin на
        // Android, чтобы Rust-команды могли мгновенно обновлять виджеты.
        .plugin(
            tauri::plugin::Builder::new("widget")
                .setup(|_app: &tauri::AppHandle, _api: tauri::plugin::PluginApi<tauri::Wry, serde_json::Value>| {
                    #[cfg(target_os = "android")]
                    {
                        let app = _app;
                        let api = _api;
                        let handle = api.register_android_plugin(
                            "com.zkproject.dailyplanner",
                            "WidgetPushPlugin",
                        )?;
                        app.manage(WidgetPush(Some(handle)));
                    }
                    Ok(())
                })
                .build(),
        )
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
            // Осиротевшие файлы вложений (без строки в БД) — чистим при старте,
            // иначе копятся на диске годами.
            commands::cleanup_orphan_attachments(app.handle(), &app.state::<Db>());
            // Разрешение на уведомления (Android 13+). Фронтенд тоже просит,
            // но полагаться на него нельзя (ACL/тайминги) — просим и здесь,
            // в фоне: системный диалог покажется при первом запуске.
            #[cfg(target_os = "android")]
            {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = h.notification().request_permission();
                });
            }
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
            // Автосинхронизация: запись/чтение JSON-файла в заданной папке
            // (десктоп; на Android content:// не понимает std::fs — там
            // ручной экспорт через плагин fs).
            commands::read_sync_file,
            commands::write_sync_file,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(
            // На Android app в матче не используется (Reopen — только macOS);
            // параметр обязателен сигнатурой RunEvent-колбэка.
            #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
            |app, event| match event {
            tauri::RunEvent::Ready => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            // Закрытие последнего окна НЕ завершает процесс: окно скрывается,
            // приложение остаётся в фоне (Dock), чтобы работали напоминания
            // и утренний дайджест. Явный выход — Cmd+Q или кнопка «Выйти»
            // в настройках (exit_app ставит флаг ALLOW_EXIT).
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.hide();
                }
            }
            // Защита от не-оконного выхода (например, завершение системы):
            // процесс держим, пока не разрешён явный выход.
            tauri::RunEvent::ExitRequested { api, .. }
                if !ALLOW_EXIT.load(std::sync::atomic::Ordering::SeqCst) =>
            {
                api.prevent_exit();
            }
            // Клик по иконке в Dock — снова показать главное окно (оно скрыто,
            // а не уничтожено — пересоздание не нужно).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        });
}

/// Флаг «разрешено выйти»: ставится перед явным выходом (exit_app), чтобы
/// RunEvent::ExitRequested не был отклонён prevent_exit.
pub static ALLOW_EXIT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn request_exit() {
    ALLOW_EXIT.store(true, std::sync::atomic::Ordering::SeqCst);
}
