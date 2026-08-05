// Планировщик уведомлений.
//
// Два типа уведомлений:
//  1. Утренний дайджест: каждый день в настраиваемый час — список
//     невыполненных задач на сегодня («микровиджет» задач на день).
//  2. Напоминания: за N минут (настраивается) до задачи, у которой задано
//     время (timeMinutes) — «пришло время заняться задачей».
//
// Реализация: отдельный поток проверяет каждые 20 секунд, наступило ли
// время какого-либо события, и показывает системное уведомление через
// tauri-plugin-notification (работает на Android и macOS).
//
// Ограничение: уведомления приходят, пока процесс приложения жив (в т.ч.
// в фоне на мобильном). Полноценное планирование «на уровне ОС» (AlarmManager
// / UNUserNotificationCenter trigger) — следующий этап, вместе с виджетами.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{Local, NaiveDate, NaiveDateTime, Timelike};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

use crate::db::Db;

/// Настройки уведомлений (дублируются из фронтенда через команду).
#[derive(serde::Deserialize, serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPrefs {
  /// Утренний список задач на день.
  #[serde(default = "default_true")]
  pub day_summary: bool,
  /// Час утреннего дайджеста (0-23).
  #[serde(default = "default_hour")]
  pub day_summary_hour: i64,
  /// Напоминания перед задачами со временем.
  #[serde(default = "default_true")]
  pub reminders: bool,
  /// За сколько минут напоминать (15/30/60/120/1440).
  #[serde(default = "default_minutes")]
  pub remind_minutes: i64,
}

fn default_true() -> bool {
  true
}
fn default_hour() -> i64 {
  8
}
fn default_minutes() -> i64 {
  60
}

/// Файл настроек — в app_config_dir (на Android — files-каталог приложения).
fn prefs_path(app: &tauri::AppHandle) -> std::path::PathBuf {
  app
    .path()
    .app_config_dir()
    .unwrap_or_else(|_| std::path::PathBuf::from("."))
    .join("notify-prefs.json")
}

pub fn load_prefs(app: &tauri::AppHandle) -> NotifyPrefs {
  let raw = std::fs::read_to_string(prefs_path(app)).unwrap_or_default();
  serde_json::from_str(&raw).unwrap_or_default()
}

/// Сохранить настройки (вызывается командой set_notification_prefs).
pub fn save_prefs(app: &tauri::AppHandle, prefs: &NotifyPrefs) -> Result<(), String> {
  let p = prefs_path(app);
  if let Some(dir) = p.parent() {
    let _ = std::fs::create_dir_all(dir);
  }
  std::fs::write(p, serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())
}

/// Отправленные события: ключ → маркер, чтобы не показывать повторно
/// (в пределах запуска; после перезапуска возможно дублирование, если окно
/// отправки ещё активно — приемлемо).
static FIRED: std::sync::OnceLock<Mutex<HashMap<String, String>>> = std::sync::OnceLock::new();

fn fired() -> &'static Mutex<HashMap<String, String>> {
  FIRED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Запустить планировщик: запрос разрешения + фоновый поток-тик.
pub fn start_scheduler(app: tauri::AppHandle) {
  // Разрешение на уведомления (Android 13+) запрашивает фронтенд через
  // JS-плагин — вызов request_permission здесь блокировал setup навсегда.
  std::thread::spawn(move || loop {
    tick(&app);
    std::thread::sleep(Duration::from_secs(20));
  });
}

/// Один проход планировщика.
fn tick(app: &tauri::AppHandle) {
  eprintln!("[notify] tick");
  let prefs = load_prefs(app);
  if !prefs.day_summary && !prefs.reminders {
    return;
  }
  let now = Local::now().naive_local();

  if prefs.day_summary {
    check_digest(app, &prefs, now);
  }
  if prefs.reminders {
    check_reminders(app, &prefs, now);
  }
}

/// Утренний дайджест: в назначенный час (окно 2 минуты) — задачи на сегодня.
fn check_digest(app: &tauri::AppHandle, prefs: &NotifyPrefs, now: NaiveDateTime) {
  let today = now.date();
  if now.hour() != prefs.day_summary_hour as u32 || now.minute() > 2 {
    return;
  }
  let key = format!("digest|{}", today);
  if fired().lock().unwrap().contains_key(&key) {
    return;
  }

  let today_epoch = days_from_epoch(today);
  let tasks = {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    let mut stmt = match conn.prepare(
      "SELECT title FROM tasks WHERE date = ?1 AND is_done = 0 AND archived = 0 AND someday = 0 ORDER BY sort_order ASC",
    ) {
      Ok(s) => s,
      Err(_) => return,
    };
    let rows = stmt
      .query_map([today_epoch], |r| r.get::<_, String>(0))
      .and_then(|it| it.collect::<Result<Vec<_>, _>>())
      .unwrap_or_default();
    rows
  };

  if tasks.is_empty() {
    // Пустой день тоже можно отмечать как «отправлено», чтобы не спамить.
    fired().lock().unwrap().insert(key, String::new());
    return;
  }

  let mut body = String::new();
  let shown = tasks.iter().take(4).collect::<Vec<_>>();
  for (i, t) in shown.iter().enumerate() {
    if i > 0 {
      body.push('\n');
    }
    body.push_str(t);
  }
  if tasks.len() > shown.len() {
    body.push_str(&format!("\n… и ещё {} задач", tasks.len() - shown.len()));
  }

  let _ = app
    .notification()
    .builder()
    .title(format!("Задачи на сегодня ({})", tasks.len()))
    .body(body)
    .show();

  fired().lock().unwrap().insert(key, String::new());
}

/// Напоминания: за remind_minutes до задач со временем (сегодня/завтра).
///
/// Ключевой момент: момент напоминания (due) считается от ДАТЫ ЗАДАЧИ, а не от
/// глобального «сегодня». Так задача на завтра с remind=1440 даст due=сегодня в
/// то же время (ровно за сутки), а задача на сегодня с remind=15 — за 15 минут.
fn check_reminders(app: &tauri::AppHandle, prefs: &NotifyPrefs, now: NaiveDateTime) {
  let today = now.date();
  let today_epoch = days_from_epoch(today);
  let tomorrow_epoch = today_epoch + 1;

  // (id, title, time_minutes, date_epoch) — дата нужна для расчёта due.
  let timed: Vec<(String, String, i64, i64)> = {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    let mut stmt = match conn.prepare(
      "SELECT id, title, time_minutes, date FROM tasks WHERE date IN (?1, ?2) AND time_minutes IS NOT NULL AND is_done = 0 AND archived = 0 AND someday = 0",
    ) {
      Ok(s) => s,
      Err(_) => return,
    };
    let rows = stmt
      .query_map([today_epoch, tomorrow_epoch], |r| {
        Ok((
          r.get::<_, String>(0)?,
          r.get::<_, String>(1)?,
          r.get::<_, i64>(2)?,
          r.get::<_, i64>(3)?,
        ))
      })
      .and_then(|it| it.collect::<Result<Vec<_>, _>>())
      .unwrap_or_default();
    rows
  };

  eprintln!("[notify] reminders: {} timed tasks, now={}", timed.len(), now);
  for (id, title, minutes, date_epoch) in timed {
    let h = (minutes / 60) as u32;
    let m = (minutes % 60) as u32;
    // Дата задачи из epoch-day (возвращает Option при выходе за диапазон).
    let task_date = match epoch_to_date(date_epoch) {
      Some(d) => d,
      None => continue,
    };
    let due = match task_date.and_hms_opt(h, m, 0) {
      Some(d) => d - chrono::Duration::minutes(prefs.remind_minutes),
      None => continue,
    };
    // Окно отправки: 2 минуты после наступления момента.
    if now < due || now > due + chrono::Duration::minutes(2) {
      continue;
    }
    let key = format!("remind|{}|{}", id, due);
    if fired().lock().unwrap().contains_key(&key) {
      continue;
    }

    let when = if prefs.remind_minutes >= 1440 {
      "завтра".to_string()
    } else if prefs.remind_minutes >= 60 {
      format!("через {} ч", prefs.remind_minutes / 60)
    } else {
      format!("через {} мин", prefs.remind_minutes)
    };
    eprintln!("[notify] reminder fired: {}", title);
    let _ = app
      .notification()
      .builder()
      .title("Напоминание")
      .body(format!("«{}» — {}", title, when))
      .show();

    fired().lock().unwrap().insert(key, String::new());
  }
}

/// epoch-day (UTC-дни с 1970-01-01) для локальной даты — так, как хранит
/// фронтенд (дата задачи = локальная дата в epoch-day).
fn days_from_epoch(date: NaiveDate) -> i64 {
  (date - NaiveDate::from_ymd_opt(1970, 1, 1).unwrap()).num_days()
}

/// Обратное преобразование: epoch-day → NaiveDate.
fn epoch_to_date(days: i64) -> Option<NaiveDate> {
  let epoch = NaiveDate::from_ymd_opt(1970, 1, 1)?;
  epoch.checked_add_days(chrono::Days::new(days.max(0) as u64))
}
