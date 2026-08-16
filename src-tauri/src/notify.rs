// Планировщик уведомлений.
//
// Два типа уведомлений:
//  1. Утренний дайджест: каждый день в настраиваемый час — список
//     невыполненных задач на сегодня («микровиджет» задач на день).
//  2. Напоминания: за N минут (настраивается) до задачи, у которой задано
//     время (timeMinutes) — «пришло время заняться задачей».
//
// Реализация зависит от платформы:
//  - Android: уведомления планируются на уровне ОС (AlarmManager через
//    tauri-plugin-notification Schedule::At). Плагин хранит отложенные
//    в своём persisted-хранилище и восстанавливает после перезагрузки
//    устройства; ОС доставляет их, даже если процесс приложения убит.
//    Каждый тик (60 с) сверяем отложенные с ожидаемыми: недостающие ставим,
//    лишние отменяем (модель «sync», а не окно отправки).
//  - Десктоп (macOS): плагин не умеет планировать на будущее — поллинг
//    каждые 60 секунд с окном отправки ±2 минуты (процесс на десктопе жив).
//
// Интервал 60 секунд — компромисс между точностью и энергопотреблением.

#[cfg(not(target_os = "android"))]
use std::collections::HashMap;
#[cfg(target_os = "android")]
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

#[cfg(not(target_os = "android"))]
use chrono::Timelike;
use chrono::{Local, NaiveDateTime, TimeZone};
use serde::Deserialize as _;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
#[cfg(target_os = "android")]
use tauri_plugin_notification::Schedule;

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
/// Только десктоп: на Android используется OS-планирование (sync_scheduled),
/// где повторение исключено самим планировщиком.
#[cfg(not(target_os = "android"))]
static FIRED: std::sync::OnceLock<Mutex<HashMap<String, i64>>> = std::sync::OnceLock::new();

#[cfg(not(target_os = "android"))]
fn fired() -> &'static Mutex<HashMap<String, i64>> {
    FIRED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Пометить событие как отправленное; заодно удалить записи старше суток.
#[cfg(not(target_os = "android"))]
fn mark_fired(key: String) {
    let now = chrono::Utc::now().timestamp_millis();
    let mut map = fired().lock().unwrap();
    if map.len() > 128 {
        // Чистим только при разросшемся кеше — retain на каждый тик лишний.
        map.retain(|_, ts| now - *ts < 86_400_000);
    }
    map.insert(key, now);
}

/// Потолок сна между тиками (десктоп). Точный интервал считает
/// next_event_from (спим до самого ближайшего события), но не дольше
/// MAX_SLEEP — страховка от перевода системных часов, DST и «молчаливых»
/// изменений задач мимо команд (импорт). 30 минут вместо жёстких 60 секунд
/// сокращает фоновые пробуждения примерно в 30 раз.
#[cfg(not(target_os = "android"))]
const MAX_SLEEP_SECS: i64 = 30 * 60;

/// Пробуждение планировщика: настройки или задачи изменились — пересчитать
/// расписание немедленно, не дожидаясь планового пробуждения.
static WAKE: std::sync::OnceLock<(std::sync::Mutex<bool>, std::sync::Condvar)> =
    std::sync::OnceLock::new();

fn wake_pair() -> &'static (std::sync::Mutex<bool>, std::sync::Condvar) {
    WAKE.get_or_init(|| (std::sync::Mutex::new(false), std::sync::Condvar::new()))
}

/// Разбудить планировщик (вызывается командами после изменения настроек и —
/// на десктопе — задач). На Android вызовы из правок задач НЕ дёргаются:
/// там серия чекбоксов означала бы лишний JNI-тик pending() на каждую.
pub fn wake_scheduler() {
    let (lock, cvar) = wake_pair();
    let mut woken = lock.lock().unwrap();
    *woken = true;
    cvar.notify_all();
}

/// Запустить планировщик: запрос разрешения + фоновый поток-тик.
pub fn start_scheduler(app: tauri::AppHandle) {
    // Разрешение на уведомления (Android 13+) запрашивает фронтенд через
    // JS-плагин — вызов request_permission здесь блокировал setup навсегда.
    std::thread::spawn(move || loop {
        // Паника в одном тике (например, сбой БД) не должна убивать
        // планировщик навсегда — ловим и продолжаем следующий цикл.
        let fell = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tick(&app))).is_err();
        let sleep = next_sleep(&app, fell);
        let (lock, cvar) = wake_pair();
        let mut woken = lock.lock().unwrap();
        while !*woken {
            let (guard, timeout) = cvar.wait_timeout(woken, sleep).unwrap();
            woken = guard;
            if timeout.timed_out() {
                break; // плановое пробуждение
            }
        }
        *woken = false;
    });
}

/// До какого момента спать. Android: фиксированный 60-с цикл — sync-модель
/// (sync_scheduled) рассчитана на частую сверку с OS-планировщиком; wake из
/// write_widget_data уже даёт мгновенный sync после правок задач. Десктоп:
/// спим до ближайшего события с потолком MAX_SLEEP (см. next_wake_in).
#[cfg(target_os = "android")]
fn next_sleep(_app: &tauri::AppHandle, _fell: bool) -> Duration {
    Duration::from_secs(60)
}

#[cfg(not(target_os = "android"))]
fn next_sleep(app: &tauri::AppHandle, fell: bool) -> Duration {
    if fell {
        // Тик упал — next_wake_in может падать по той же причине
        // (например, БД недоступна): не крутим panic-loop на максимумах.
        return Duration::from_secs(60);
    }
    // Сам расчёт тоже под catch_unwind: паника здесь убила бы поток.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| next_wake_in(app)))
        .unwrap_or(Duration::from_secs(60))
}

/// До какого момента спать (десктоп): ближайшее интересное событие —
/// due напоминания, час дайджеста или смена дня для виджета.
#[cfg(not(target_os = "android"))]
fn next_wake_in(app: &tauri::AppHandle) -> Duration {
    let prefs = load_prefs(app);
    let now = Local::now().naive_local();
    let tasks = if prefs.reminders {
        load_timed_tasks(app)
    } else {
        Vec::new()
    };
    let target = next_event_from(&prefs, &tasks, now);
    let secs = (target - now).num_seconds().clamp(1, MAX_SLEEP_SECS);
    Duration::from_secs(secs as u64)
}

/// Чистый расчёт ближайшего события (без AppHandle — для юнит-тестов).
/// Смена дня обязательна всегда: планировщик обновляет виджет после полуночи.
#[cfg(not(target_os = "android"))]
fn next_event_from(
    prefs: &NotifyPrefs,
    tasks: &[ReminderRow],
    now: NaiveDateTime,
) -> NaiveDateTime {
    let mut best: Option<NaiveDateTime> = None;
    let mut consider = |d: Option<NaiveDateTime>| {
        if let Some(d) = d {
            if d > now && best.is_none_or(|b| d < b) {
                best = Some(d);
            }
        }
    };
    // Смена дня (+5 с запаса на полуночную границу) — обновление виджета.
    consider(
        now.date()
            .checked_add_days(chrono::Days::new(1))
            .and_then(|d| d.and_hms_opt(0, 0, 5)),
    );
    // Утренний дайджест сегодня (если час не прошёл) или завтра.
    if prefs.day_summary {
        let h = prefs.day_summary_hour.clamp(0, 23) as u32;
        let today = now.date().and_hms_opt(h, 0, 0);
        consider(if today.is_some_and(|d| d > now) {
            today
        } else {
            now.date()
                .checked_add_days(chrono::Days::new(1))
                .and_then(|d| d.and_hms_opt(h, 0, 0))
        });
    }
    // Напоминания: ближайший due по тем же правилам, что и отправка
    // (интервалы глобальные/свои + «пора выезжать»).
    if prefs.reminders {
        for (_, _, minutes, date_epoch, travel_time, notify_minutes) in tasks.iter() {
            if *notify_minutes == Some(0) {
                continue;
            }
            let Some(start) = task_start(*minutes, *date_epoch) else {
                continue;
            };
            for rm in task_intervals(*notify_minutes, prefs) {
                consider(Some(due_at(start, rm)));
            }
            if let Some(tt) = travel_time {
                if *tt > 0 {
                    consider(Some(due_at(start, *tt)));
                }
            }
        }
    }
    best.unwrap_or_else(|| now + chrono::Duration::seconds(MAX_SLEEP_SECS))
}

/// День, для которого виджет уже записан (i64::MIN = ещё не писался).
static WIDGET_DAY: std::sync::OnceLock<Mutex<i64>> = std::sync::OnceLock::new();

fn widget_day() -> &'static Mutex<i64> {
    WIDGET_DAY.get_or_init(|| Mutex::new(i64::MIN))
}

/// Один проход планировщика.
fn tick(app: &tauri::AppHandle) {
    // Канал уведомлений создаём один раз с фонового потока (см. ensure_tasks_channel).
    #[cfg(target_os = "android")]
    ensure_tasks_channel(app);
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
        // Тему берём из предыдущей записи виджета: планировщик не знает
        // настройки темы фронтенда (она в localStorage WebView).
        let dark = crate::commands::read_widget_dark(app);
        let _ = crate::commands::refresh_widget(app, &state, dark);
    }
    let prefs = load_prefs(app);
    if !prefs.day_summary && !prefs.reminders {
        return;
    }
    // Android: OS-планирование (уведомления приходят даже при убитом
    // процессе). Десктоп: поллинг с окном ±2 мин (процесс жив всегда).
    #[cfg(target_os = "android")]
    {
        sync_scheduled(app, &prefs);
    }
    #[cfg(not(target_os = "android"))]
    {
        let now = Local::now().naive_local();
        if prefs.day_summary {
            check_digest(app, &prefs, now);
        }
        if prefs.reminders {
            check_reminders(app, &prefs, now);
        }
    }
}

// ── Android: планирование на уровне ОС (AlarmManager) ────────────────────

/// NaiveDateTime → DateTime<Local> с запасом для DST-неоднозначных времён
/// (fallback — UTC-интерпретация). Единый для расчёта due, unix-таймстампов
/// и планирования.
fn to_local(dt: &NaiveDateTime) -> chrono::DateTime<Local> {
    Local
        .from_local_datetime(dt)
        .single()
        .unwrap_or_else(|| Local.from_utc_datetime(dt))
}

/// Тело утреннего дайджеста на десктопе: до 4 заголовков + «…и ещё N задач».
#[cfg(not(target_os = "android"))]
fn digest_body(titles: &[String]) -> String {
    let mut body = String::new();
    for (i, t) in titles.iter().take(4).enumerate() {
        if i > 0 {
            body.push('\n');
        }
        body.push_str(t);
    }
    if titles.len() > 4 {
        body.push_str(&format!("\n… и ещё {} задач", titles.len() - 4));
    }
    body
}

/// Кандидат в напоминание: момент due, заголовок/тело и данные для стабильного
/// id/ключа дедупликации. Расчёт ОДИН для Android (OS-планирование) и десктопа
/// (поллинг) — окно доставки применяет платформенный потребитель.
struct ReminderEvent {
    /// "remind" (за N минут) или "travel" (выехать заранее).
    kind: &'static str,
    task_id: String,
    due: NaiveDateTime,
    title: &'static str,
    body: String,
}

/// Все напоминания задач из горизонта load_timed_tasks (без окон доставки).
fn reminder_events(app: &tauri::AppHandle, prefs: &NotifyPrefs) -> Vec<ReminderEvent> {
    let mut out = Vec::new();
    for (id, title, minutes, date_epoch, travel_time, notify_minutes) in load_timed_tasks(app) {
        // Своё «не уведомлять» (0) — пропускаем задачу целиком, включая выезд.
        if notify_minutes == Some(0) {
            continue;
        }
        let Some(start) = task_start(minutes, date_epoch) else {
            continue;
        };
        // Выбранные интервалы напоминаний — каждому своё уведомление.
        for rm in task_intervals(notify_minutes, prefs) {
            out.push(ReminderEvent {
                kind: "remind",
                task_id: id.clone(),
                due: due_at(start, rm),
                title: "Напоминание",
                body: format!("«{title}» — {}", format_interval(rm)),
            });
        }
        // «Пора выезжать»: за travel_time до начала задачи (если задано).
        if let Some(tt) = travel_time {
            if tt > 0 {
                out.push(ReminderEvent {
                    kind: "travel",
                    task_id: id.clone(),
                    due: due_at(start, tt),
                    title: "Пора выезжать",
                    body: format!("«{title}» — в {:02}:{:02}", minutes / 60, minutes % 60),
                });
            }
        }
    }
    out
}

/// ID утреннего дайджеста в OS-планировщике: вне диапазона хэшей задач
/// (stable_id даёт 1..1_000_000), чтобы не пересечься с напоминаниями.
#[cfg(target_os = "android")]
const DIGEST_NOTIFICATION_ID: i32 = 1_000_000;

/// Канал уведомлений Android. Плагин по умолчанию создаёт канал с
/// IMPORTANCE_DEFAULT — уведомления приходят тихо в шторку (без звука и
/// heads-up) и легко теряются. Свой канал с IMPORTANCE_HIGH: звук, вибрация,
/// всплывание поверх приложений. Создаётся один раз на фоновом потоке
/// планировщика (sync-вызов run_mobile_plugin с главного потока — дедлок).
#[cfg(target_os = "android")]
const TASKS_CHANNEL_ID: &str = "tasks";

#[cfg(target_os = "android")]
fn ensure_tasks_channel(app: &tauri::AppHandle) {
    static DONE: std::sync::Once = std::sync::Once::new();
    DONE.call_once(|| {
        use tauri_plugin_notification::{Channel, Importance};
        let _ = app.notification().create_channel(
            Channel::builder(TASKS_CHANNEL_ID, "Напоминания и задачи")
                .description("Напоминания о задачах и утренний список дел")
                .importance(Importance::High)
                .vibration(true)
                .lights(true)
                .build(),
        );
    });
}

/// Стабильный id уведомления: зависит от задачи, типа («remind»/«travel»)
/// и момента due с точностью до минуты. Если время задачи меняется — id
/// меняется, старое уведомление отменяется как «лишнее», новое планируется.
/// FNV-1a 32-bit — детерминирован между запусками и версиями приложения.
#[cfg(target_os = "android")]
fn stable_id(salt: &str, task_id: &str, due_minute: i64) -> i32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in format!("{salt}|{task_id}|{due_minute}").bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    (h % 999_999) as i32 + 1
}

/// Запланировать уведомление на момент `due` (локальное время) через плагин:
/// AlarmManager доставит его, даже если процесс приложения убит. Канал —
/// TASKS_CHANNEL_ID (высокая важность: звук и heads-up).
#[cfg(target_os = "android")]
fn schedule_at(app: &tauri::AppHandle, id: i32, title: &str, body: &str, due: NaiveDateTime) {
    // Абсолютный момент в unix-секундах — смещение часового пояса в
    // ISO-строке плагину не нужно: Kotlin ставит будильник по миллисекундам.
    let ts = to_local(&due).timestamp();
    let Ok(at) = time::OffsetDateTime::from_unix_timestamp(ts) else {
        return;
    };
    let _ = app
        .notification()
        .builder()
        .id(id)
        .title(title)
        .body(body)
        .channel_id(TASKS_CHANNEL_ID)
        .schedule(Schedule::At {
            date: at,
            repeating: false,
            allow_while_idle: true,
        })
        .show();
}

/// Дайджест «Список дел на день»: InboxStyle-уведомление — каждая задача
/// строкой («09:00  Задача»), в развёрнутом виде — весь список, а не
/// обрезанные 4 строки, как в плоском body.
#[cfg(target_os = "android")]
fn schedule_digest(app: &tauri::AppHandle, ts: NaiveDateTime, rows: &[(String, Option<i64>)]) {
    let Ok(at) = time::OffsetDateTime::from_unix_timestamp(to_local(&ts).timestamp()) else {
        return;
    };
    let n = rows.len();
    let mut b = app
        .notification()
        .builder()
        .id(DIGEST_NOTIFICATION_ID)
        .title(format!("Задачи на сегодня ({n})"))
        .channel_id(TASKS_CHANNEL_ID)
        .schedule(Schedule::At {
            date: at,
            repeating: false,
            allow_while_idle: true,
        });
    for (title, time) in rows {
        let line = match time {
            Some(m) => format!("{:02}:{:02}  {}", m / 60, m % 60, title),
            None => title.clone(),
        };
        b = b.inbox_line(line);
    }
    b = b.summary(if n == 1 { "1 задача".to_string() } else { format!("{n} задач") });
    let _ = b.show();
}

/// Android: сверка OS-планировщика с ожидаемыми уведомлениями.
///
/// Модель «sync»: каждый тик сравниваем отложенные уведомления плагина
/// (pending(), persisted в его хранилище) с тем, что должно быть запланировано.
/// Недостающие ставим на момент due, лишние отменяем (задача выполнена,
/// удалена, время изменено). После срабатывания одноразового уведомления
/// плагин удаляет его запись — следующий день планируется при первом тике.
#[cfg(target_os = "android")]
fn sync_scheduled(app: &tauri::AppHandle, prefs: &NotifyPrefs) {
    let notif = app.notification();
    let pending_ids: HashSet<i32> = match notif.pending() {
        Ok(list) => list.iter().map(|p| p.id()).collect(),
        Err(e) => {
            eprintln!("[notify] не удалось получить отложенные уведомления: {e}");
            return;
        }
    };
    let mut expected: HashSet<i32> = HashSet::new();
    let now = Local::now().naive_local();

    // 1. Утренний дайджест: одноразовое At на сегодняшний час (пока не
    // наступил). InboxStyle-список всех задач дня с временем. Тело считается
    // в момент планирования — задачи на день актуальны. Пустой день не
    // планируем вовсе (не спамим).
    if prefs.day_summary {
        if let Some(ts) = Local::now()
            .date_naive()
            .and_hms_opt(prefs.day_summary_hour as u32, 0, 0)
        {
            if ts > now {
                expected.insert(DIGEST_NOTIFICATION_ID);
                if !pending_ids.contains(&DIGEST_NOTIFICATION_ID) {
                    let tasks = today_task_rows(app);
                    if !tasks.is_empty() {
                        schedule_digest(app, ts, &tasks);
                    }
                }
            }
        }
    }

    // 2. Напоминания задач (глобальные интервалы / своё notify_minutes /
    // travel_time «Пора выезжать»). Расчёт событий общий с десктопом
    // (reminder_events) — здесь только планирование на уровне ОС.
    if prefs.reminders {
        for ev in reminder_events(app, prefs) {
            // Горизонт: строго в будущем и в пределах выборки (+7 дней) —
            // просроченные не планируем, слишком далёкие не достаём.
            if ev.due <= now || ev.due > now + chrono::Duration::days(7) {
                continue;
            }
            let nid = stable_id(ev.kind, &ev.task_id, due_unix_minute(ev.due));
            expected.insert(nid);
            if !pending_ids.contains(&nid) {
                schedule_at(app, nid, ev.title, &ev.body, ev.due);
            }
        }
    }

    // 3. Отмена лишних: запланированные, но не ожидаемые — задача выполнена,
    // удалена или её время изменилось (id у нового due другой).
    for id in pending_ids {
        if !expected.contains(&id) {
            let _ = notif.cancel(vec![id]);
        }
    }
}

/// Момент due как unix-минута — для стабильного id (не зависит от таймзоны).
#[cfg(target_os = "android")]
fn due_unix_minute(due: NaiveDateTime) -> i64 {
    to_local(&due).timestamp() / 60
}

/// Заголовки невыполненных задач на сегодня (для тела дайджеста на десктопе).
#[cfg(not(target_os = "android"))]
fn today_titles(app: &tauri::AppHandle) -> Vec<String> {
    today_task_rows(app).into_iter().map(|(t, _)| t).collect()
}

/// Строки невыполненных задач на сегодня: заголовок + время. Порядок — как
/// в виджете: сначала задачи с временем (по времени), затем без.
fn today_task_rows(app: &tauri::AppHandle) -> Vec<(String, Option<i64>)> {
    let today_epoch = crate::commands::today_epoch_day();
    let db = app.state::<Db>();
    // db.lock() — poison-safe (возвращает данные даже при отравленном мьютексе,
    // см. Db::lock); db.0.lock().unwrap() падал бы на каждом тике после паники
    // в другом потоке, хоть tick() и ловит её через catch_unwind.
    let conn = db.lock();
    conn.prepare(
      "SELECT title, time_minutes FROM tasks WHERE date = ?1 AND is_done = 0 AND archived = 0 AND someday = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, sort_order ASC, created_at ASC",
    )
    .and_then(|mut stmt| {
        stmt.query_map([today_epoch], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
        })
        .and_then(|it| it.collect::<Result<Vec<_>, _>>())
    })
    .unwrap_or_default()
}

/// Утренний дайджест (десктоп): в назначенный час (окно 2 минуты) — задачи
/// на сегодня. На Android вместо этого используется OS-планирование.
#[cfg(not(target_os = "android"))]
fn check_digest(app: &tauri::AppHandle, prefs: &NotifyPrefs, now: NaiveDateTime) {
    if now.hour() != prefs.day_summary_hour as u32 || now.minute() > 2 {
        return;
    }
    let key = format!("digest|{}", now.date());
    if fired().lock().unwrap().contains_key(&key) {
        return;
    }

    let tasks = today_titles(app);

    if tasks.is_empty() {
        // Пустой день тоже можно отмечать как «отправлено», чтобы не спамить.
        mark_fired(key);
        return;
    }

    let body = digest_body(&tasks);

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

/// Задачи со временем в горизонте (сегодня..+7 дней) для расчёта напоминаний.
/// +7 дней покрывает глобальные интервалы и свои notify_minutes до 7 суток
/// (настройка «Уведомить» позволяет напоминать за неделю).
fn load_timed_tasks(app: &tauri::AppHandle) -> Vec<ReminderRow> {
    let today_epoch = crate::commands::today_epoch_day();
    let horizon_epoch = today_epoch + 7;
    let db = app.state::<Db>();
    let conn = db.lock();
    let mut stmt = match conn.prepare(
      "SELECT id, title, time_minutes, date, travel_time, notify_minutes FROM tasks WHERE date BETWEEN ?1 AND ?2 AND time_minutes IS NOT NULL AND is_done = 0 AND archived = 0 AND someday = 0",
    ) {
      Ok(s) => s,
      Err(e) => {
        eprintln!("[notify] не удалось подготовить запрос напоминаний: {:?}", e);
        return Vec::new();
      }
    };
    stmt.query_map([today_epoch, horizon_epoch], |r| {
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
    .unwrap_or_default()
}

/// Интервалы напоминаний задачи: своё notify_minutes (N>0) перекрывает
/// глобальные настройки; 0 отфильтровывается вызывающим (задачу не уведомлять).
fn task_intervals(notify_minutes: Option<i64>, prefs: &NotifyPrefs) -> Vec<i64> {
    match notify_minutes {
        Some(n) if n > 0 => vec![n],
        _ => prefs.remind_minutes.clone(),
    }
}

/// Начало задачи (локальная дата + время) — Option при некорректных данных.
fn task_start(minutes: i64, date_epoch: i64) -> Option<NaiveDateTime> {
    let h = (minutes / 60) as u32;
    let m = (minutes % 60) as u32;
    let task_date = crate::commands::epoch_to_date(date_epoch)?;
    task_date.and_hms_opt(h, m, 0)
}

/// Человеческое «за сколько» для тела напоминания: 1440 → «за 1 дн».
fn format_interval(rm: i64) -> String {
    if rm >= 1440 {
        if rm % 1440 == 0 {
            format!("за {} дн", rm / 1440)
        } else {
            format!("за {} дн {} ч", rm / 1440, (rm % 1440) / 60)
        }
    } else if rm >= 60 {
        format!("через {} ч", rm / 60)
    } else {
        format!("через {} мин", rm)
    }
}

/// Момент «за N минут до start» с учётом часового пояса. Наивная арифметика
/// NaiveDateTime в дни перехода времени (DST) сдвигает момент на час — считаем
/// через Local (знает смещение), затем возвращаем локальную дату-время.
fn due_at(start: NaiveDateTime, minutes: i64) -> NaiveDateTime {
    (to_local(&start) - chrono::Duration::minutes(minutes)).naive_local()
}

/// Напоминания (десктоп): за remind_minutes до задач со временем.
/// На Android вместо этого используется OS-планирование (sync_scheduled).
#[cfg(not(target_os = "android"))]
fn check_reminders(app: &tauri::AppHandle, prefs: &NotifyPrefs, now: NaiveDateTime) {
    // Ключевой момент: момент напоминания (due) считается от ДАТЫ ЗАДАЧИ, а не от
    // глобального «сегодня». Так задача на завтра с remind=1440 даст due=сегодня в
    // то же время (ровно за сутки), а задача на сегодня с remind=15 — за 15 минут.
    // remind_minutes — массив: для каждого выбранного интервала своё уведомление.
    // У задачи может быть СВОЁ время уведомления (notify_minutes): NULL = глобальные
    // интервалы из настроек, 0 = не уведомлять, N = напомнить за N минут (одно
    // уведомление вместо всех глобальных). Если задано travel_time — дополнительно
    // «Пора выезжать» за это время до начала.
    for ev in reminder_events(app, prefs) {
        // Окно отправки: 2 минуты после наступления момента.
        if now < ev.due || now > ev.due + chrono::Duration::minutes(2) {
            continue;
        }
        // Ключ дедупликации: id + момент due достаточны — разные интервалы
        // одной задачи дают разные due (разница ≥ 1 мин), коллизий нет.
        let key = if ev.kind == "travel" {
            format!("remind|travel|{}|{}", ev.task_id, ev.due)
        } else {
            format!("remind|{}|{}", ev.task_id, ev.due)
        };
        if fired().lock().unwrap().contains_key(&key) {
            continue;
        }
        let _ = app
            .notification()
            .builder()
            .title(ev.title)
            .body(ev.body)
            .show();
        mark_fired(key);
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn prefs(day_summary: bool, reminders: bool, remind: Vec<i64>) -> NotifyPrefs {
        NotifyPrefs {
            day_summary,
            day_summary_hour: 8,
            reminders,
            remind_minutes: remind,
        }
    }

    /// Задача 2026-08-16 10:00 (id, title, time_minutes, date_epoch, travel, notify).
    fn task(minutes: i64, date_epoch: i64, notify: Option<i64>) -> ReminderRow {
        (
            "t1".into(),
            "Задача".into(),
            minutes,
            date_epoch,
            None,
            notify,
        )
    }

    /// Уведомления выключены → ближайшее событие — полночь (смена дня виджета).
    #[test]
    fn next_event_all_off_is_midnight() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 15)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        let ev = next_event_from(&prefs(false, false, vec![60]), &[], now);
        assert_eq!(
            ev,
            NaiveDate::from_ymd_opt(2026, 8, 16)
                .unwrap()
                .and_hms_opt(0, 0, 5)
                .unwrap()
        );
    }

    /// Дайджест ещё не прошёл сегодня → спим до него, а не до полуночи.
    #[test]
    fn next_event_digest_today_wins_over_midnight() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 15)
            .unwrap()
            .and_hms_opt(6, 30, 0)
            .unwrap();
        let ev = next_event_from(&prefs(true, false, vec![]), &[], now);
        assert_eq!(ev, now.date().and_hms_opt(8, 0, 0).unwrap());
    }

    /// Дайджест сегодня прошёл → сначала полуночь (виджет), а тик после
    /// полуночи уже выберет завтрашний дайджест.
    #[test]
    fn next_event_after_digest_is_midnight_then_digest() {
        let day = NaiveDate::from_ymd_opt(2026, 8, 15).unwrap();
        let now = day.and_hms_opt(9, 0, 0).unwrap();
        // В 9:00 ближайшее событие — смена дня (полночь + 5 с).
        let ev = next_event_from(&prefs(true, false, vec![]), &[], now);
        assert_eq!(
            ev,
            NaiveDate::from_ymd_opt(2026, 8, 16)
                .unwrap()
                .and_hms_opt(0, 0, 5)
                .unwrap()
        );
        // После полуночного тика ближайшее — утренний дайджест в 8:00.
        let after_midnight = NaiveDate::from_ymd_opt(2026, 8, 16)
            .unwrap()
            .and_hms_opt(0, 0, 6)
            .unwrap();
        let ev2 = next_event_from(&prefs(true, false, vec![]), &[], after_midnight);
        assert_eq!(ev2, after_midnight.date().and_hms_opt(8, 0, 0).unwrap());
    }

    /// Задача через час с напоминанием за 60 мин → due уже почти сейчас:
    /// берём min(due, полуночь) = due. Прошедшие due игнорируются.
    #[test]
    fn next_event_nearest_reminder() {
        let day = NaiveDate::from_ymd_opt(2026, 8, 15).unwrap();
        let now = day.and_hms_opt(9, 30, 0).unwrap();
        // Задача сегодня 11:00, напоминание за 60 мин → due 10:00.
        // И задача сегодня 8:00 (прошла) — её due не должен победить.
        let tasks = vec![
            task(11 * 60, crate::commands::date_to_epoch(day), None),
            task(8 * 60, crate::commands::date_to_epoch(day), None),
        ];
        let ev = next_event_from(&prefs(true, true, vec![60]), &tasks, now);
        assert_eq!(ev, day.and_hms_opt(10, 0, 0).unwrap());
    }

    /// Своё notify_minutes перекрывает глобальные интервалы.
    #[test]
    fn task_intervals_own_override() {
        let p = prefs(true, true, vec![15, 60]);
        assert_eq!(task_intervals(Some(1440), &p), vec![1440]);
        assert_eq!(task_intervals(None, &p), vec![15, 60]);
        assert_eq!(task_intervals(Some(0), &p), vec![15, 60]); // 0 фильтруется вызывающим
    }
}
