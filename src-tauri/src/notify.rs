// Планировщик уведомлений.
//
// Два типа уведомлений:
//  1. Утренний дайджест: каждый день в настраиваемый час — список
//     невыполненных задач на сегодня («микровиджет» задач на день).
//  2. Напоминания: за N минут (настраивается) до задачи, у которой задано
//     время (timeMinutes) — «пришло время заняться задачей».
//
// Реализация: отдельный поток проверяет каждые 60 секунд, наступило ли
// время какого-либо события, и показывает системное уведомление через
// tauri-plugin-notification (работает на Android и macOS).
// Интервал 60 секунд — компромисс между точностью уведомлений (окно ±1 мин)
// и энергопотреблением: процесс не просыпается каждые 20 секунд ради
// виджета, данные которого приложение и так обновляет при каждом изменении.
//
// Ограничение: уведомления приходят, пока процесс приложения жив (в т.ч.
// в фоне на мобильном). Полноценное планирование «на уровне ОС» (AlarmManager
// / UNUserNotificationCenter trigger) — следующий этап, вместе с виджетами.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone, Timelike};
use serde::Deserialize as _;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

use crate::db::Db;

/// Настройки уведомлений (дублируются из фронтенда через команду).
#[derive(serde::Deserialize, serde::Serialize, Clone)]
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
    /// За сколько минут напоминать — МАССИВ: можно выбрать несколько интервалов
    /// сразу (например, за час И за день); каждое значение даёт своё уведомление.
    /// Принимает и старое значение-число (60) → превращается в [60].
    #[serde(default = "default_minutes", deserialize_with = "de_minutes")]
    pub remind_minutes: Vec<i64>,
}

/// Двунаправленный формат remind_minutes: число (старые настройки) или массив.
fn de_minutes<'de, D>(d: D) -> Result<Vec<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum M {
        One(i64),
        Many(Vec<i64>),
    }
    Ok(match M::deserialize(d)? {
        M::One(v) => vec![v],
        M::Many(v) => v,
    })
}

impl Default for NotifyPrefs {
    /// Рабочие дефолты (не false/[] как у derive): уведомления включены.
    fn default() -> Self {
        NotifyPrefs {
            day_summary: default_true(),
            day_summary_hour: default_hour(),
            reminders: default_true(),
            remind_minutes: default_minutes(),
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_hour() -> i64 {
    8
}
fn default_minutes() -> Vec<i64> {
    vec![60]
}

/// Файл настроек — в app_config_dir (на Android — files-каталог приложения).
fn prefs_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("notify-prefs.json")
}

pub fn load_prefs(app: &tauri::AppHandle) -> NotifyPrefs {
    let raw = std::fs::read_to_string(prefs_path(app)).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Сохранить настройки (вызывается командой set_notification_prefs).
/// Пишем атомарно: сначала во временный файл, затем rename — если запись
/// оборвётся (сбой питания, выгрузка процесса), старые настройки не
/// превратятся в обрезанный/пустой JSON.
pub fn save_prefs(app: &tauri::AppHandle, prefs: &NotifyPrefs) -> Result<(), String> {
    let p = prefs_path(app);
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Отправленные события: ключ → время отправки (epoch-ms), чтобы не показывать
/// повторно в пределах запуска. Записи старше суток чистятся при каждом тике —
/// иначе кеш растёт бесконечно (каждый день и каждое напоминание добавляют
/// ключ, который больше никогда не удаляется).
static FIRED: std::sync::OnceLock<Mutex<HashMap<String, i64>>> = std::sync::OnceLock::new();

fn fired() -> &'static Mutex<HashMap<String, i64>> {
    FIRED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Пометить событие как отправленное; заодно удалить записи старше суток.
fn mark_fired(key: String) {
    let now = chrono::Utc::now().timestamp_millis();
    let mut map = fired().lock().unwrap();
    if map.len() > 128 {
        // Чистим только при разросшемся кеше — retain на каждый тик лишний.
        map.retain(|_, ts| now - *ts < 86_400_000);
    }
    map.insert(key, now);
}

/// Запустить планировщик: запрос разрешения + фоновый поток-тик.
pub fn start_scheduler(app: tauri::AppHandle) {
    // Разрешение на уведомления (Android 13+) запрашивает фронтенд через
    // JS-плагин — вызов request_permission здесь блокировал setup навсегда.
    std::thread::spawn(move || loop {
        // Паника в одном тике (например, сбой БД) не должна убивать
        // планировщик навсегда — ловим и продолжаем следующий цикл.
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tick(&app))).is_err() {
            eprintln!("[notify] тик планировщика упал, продолжаю через 60 с");
        }
        std::thread::sleep(Duration::from_secs(60));
    });
}

/// День, для которого виджет уже записан (i64::MIN = ещё не писался).
static WIDGET_DAY: std::sync::OnceLock<Mutex<i64>> = std::sync::OnceLock::new();

fn widget_day() -> &'static Mutex<i64> {
    WIDGET_DAY.get_or_init(|| Mutex::new(i64::MIN))
}

/// Один проход планировщика.
fn tick(app: &tauri::AppHandle) {
    // Виджет: обновляем при старте и при смене календарного дня. Писать файл
    // каждые 60 секунд не нужно — фронтенд и так обновляет данные при каждом
    // изменении задач (write_widget_data), а здесь достаточно поймать смену
    // даты (иначе утром виджет показывал бы вчерашний список).
    let today = crate::commands::today_epoch_day();
    let mut last = widget_day().lock().unwrap();
    if *last != today {
        *last = today;
        drop(last);
        let state = app.state::<Db>();
        let _ = crate::commands::refresh_widget(app, &state);
    }
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
    if now.hour() != prefs.day_summary_hour as u32 || now.minute() > 2 {
        return;
    }
    let key = format!("digest|{}", now.date());
    if fired().lock().unwrap().contains_key(&key) {
        return;
    }

    let today_epoch = crate::commands::today_epoch_day();
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
        mark_fired(key);
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

    mark_fired(key);
}

/// Строка задачи с полями, нужными для расчёта напоминания.
type ReminderRow = (String, String, i64, i64, Option<i64>, Option<i64>);

/// Момент «за N минут до start» с учётом часового пояса. Наивная арифметика
/// NaiveDateTime в дни перехода времени (DST) сдвигает момент на час — считаем
/// через Local (знает смещение), затем возвращаем локальную дату-время.
fn due_at(start: NaiveDateTime, minutes: i64) -> NaiveDateTime {
    let local = Local
        .from_local_datetime(&start)
        .single()
        .unwrap_or_else(|| Local.from_utc_datetime(&start))
        - chrono::Duration::minutes(minutes);
    local.naive_local()
}

/// Напоминания: за remind_minutes до задач со временем (сегодня/завтра).
///
/// Ключевой момент: момент напоминания (due) считается от ДАТЫ ЗАДАЧИ, а не от
/// глобального «сегодня». Так задача на завтра с remind=1440 даст due=сегодня в
/// то же время (ровно за сутки), а задача на сегодня с remind=15 — за 15 минут.
/// remind_minutes — массив: для каждого выбранного интервала своё уведомление.
/// У задачи может быть СВОЁ время уведомления (notify_minutes): NULL = глобальные
/// интервалы из настроек, 0 = не уведомлять, N = напомнить за N минут (одно
/// уведомление вместо всех глобальных). Если задано travel_time — дополнительно
/// «Пора выезжать» за это время до начала.
fn check_reminders(app: &tauri::AppHandle, prefs: &NotifyPrefs, now: NaiveDateTime) {
    let today_epoch = crate::commands::today_epoch_day();
    // Горизонт выборки: сегодня + 7 дней. Покрывает глобальные интервалы и
    // свои значения notify_minutes до 7 суток (настройка «Уведомить» позволяет
    // напоминать за неделю; задача на +7 дней с напоминанием «за 7 дней» всё
    // ещё в выборке, когда приходит её момент).
    let horizon_epoch = today_epoch + 7;

    // (id, title, time_minutes, date_epoch, travel_time, notify_minutes) — дата,
    // время в пути и своё уведомление нужны для расчёта due. travel_time может
    // отсутствовать в старых БД — query_map вернёт NULL как None.
    let timed: Vec<ReminderRow> = {
        let db = app.state::<Db>();
        let conn = db.lock();
        let mut stmt = match conn.prepare(
      "SELECT id, title, time_minutes, date, travel_time, notify_minutes FROM tasks WHERE date BETWEEN ?1 AND ?2 AND time_minutes IS NOT NULL AND is_done = 0 AND archived = 0 AND someday = 0",
    ) {
      Ok(s) => s,
      Err(e) => {
        eprintln!("[notify] не удалось подготовить запрос напоминаний: {:?}", e);
        return;
      }
    };
        let rows = stmt
            .query_map([today_epoch, horizon_epoch], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                ))
            })
            .and_then(|it| it.collect::<Result<Vec<_>, _>>())
            .unwrap_or_default();
        rows
    };

    for (id, title, minutes, date_epoch, travel_time, notify_minutes) in timed {
        // Своё «не уведомлять» (0) — пропускаем задачу целиком, включая выезд.
        if notify_minutes == Some(0) {
            continue;
        }
        let h = (minutes / 60) as u32;
        let m = (minutes % 60) as u32;
        // Дата задачи из epoch-day (возвращает Option при выходе за диапазон).
        let task_date = match epoch_to_date(date_epoch) {
            Some(d) => d,
            None => continue,
        };
        let start = match task_date.and_hms_opt(h, m, 0) {
            Some(d) => d,
            None => continue,
        };

        // Своё время уведомления задачи (одно значение) вместо глобальных
        // интервалов, если задано.
        let intervals: Vec<i64> = match notify_minutes {
            Some(n) if n > 0 => vec![n],
            _ => prefs.remind_minutes.clone(),
        };

        // 1. Выбранные интервалы напоминаний — каждому своё уведомление.
        for rm in intervals {
            let due = due_at(start, rm);
            // Окно отправки: 2 минуты после наступления момента.
            if now < due || now > due + chrono::Duration::minutes(2) {
                continue;
            }
            let key = format!("remind|{}|{}|{}", id, rm, due);
            if fired().lock().unwrap().contains_key(&key) {
                continue;
            }
            let when = if rm >= 1440 {
                if rm % 1440 == 0 {
                    format!("за {} дн", rm / 1440)
                } else {
                    format!("за {} дн {} ч", rm / 1440, (rm % 1440) / 60)
                }
            } else if rm >= 60 {
                format!("через {} ч", rm / 60)
            } else {
                format!("через {} мин", rm)
            };
            let _ = app
                .notification()
                .builder()
                .title("Напоминание")
                .body(format!("«{}» — {}", title, when))
                .show();
            mark_fired(key);
        }

        // 2. «Пора выезжать»: за travel_time до начала задачи (если задано).
        if let Some(tt) = travel_time {
            if tt > 0 {
                let due = due_at(start, tt);
                if now >= due && now <= due + chrono::Duration::minutes(2) {
                    let key = format!("remind|travel|{}|{}", id, due);
                    if fired().lock().unwrap().contains_key(&key) {
                        continue;
                    }
                    let _ = app
                        .notification()
                        .builder()
                        .title("Пора выезжать")
                        .body(format!("«{}» — в {:02}:{:02}", title, h, m))
                        .show();
                    mark_fired(key);
                }
            }
        }
    }
}

/// Обратное преобразование: epoch-day → NaiveDate.
fn epoch_to_date(days: i64) -> Option<NaiveDate> {
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1)?;
    epoch.checked_add_days(chrono::Days::new(days.max(0) as u64))
}
