// Планировщик уведомлений.
//
// Два типа уведомлений:
//  1. Утренний дайджест: каждый день в настраиваемый час — список
//     невыполненных задач на сегодня («микровиджет» задач на день).
//  2. Напоминания: за N минут (настраивается) до задачи, у которой задано
//     время (timeMinutes) — «пришло время заняться задачей».
//
// Реализация зависит от платформы:
//  - Android: уведомления планируются на уровне ОС (AlarmManager) через мост
//    «widget» — WidgetPushPlugin.persistScheduled: будильник + запись в
//    persisted-хранилище плагина. Без записи в хранилище pending() пуст, а
//    BOOT-restore после перезагрузки терял все напоминания (show() плагина
//    2.3.3 в хранилище не пишет — пишет только batch). ОС доставляет
//    уведомления и при убитом процессе.
//    Напоминания — одноразовые At-алармы. Дайджест — ПОВТОРЯЮЩИЙСЯ Interval-
//    аларм («каждый день в настроенный час»): ОС сама ставит следующий после
//    каждого срабатывания (TimedNotificationPublisher по CRON_KEY) и
//    восстанавливает после перезагрузки. Прежний одноразовый At умирал: после
//    срабатывания или смерти процесса никто не ставил следующий, и дайджест
//    замолкал до очередного запуска приложения (симптом: «в 8 утра не
//    приходят»). Каждый тик (60 с) обновляем контент дня, лишние отменяем
//    (модель «sync», а не окно отправки).
//  - Десктоп (macOS): плагин не умеет планировать на будущее — поллинг
//    каждые 60 секунд с окном отправки до 15 минут после due (см.
//    check_reminders; процесс на десктопе жив).
//
// Интервал 60 секунд — компромисс между точностью и энергопотреблением.

#[cfg(not(target_os = "android"))]
use std::collections::HashMap;
#[cfg(target_os = "android")]
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

// Timelike нужен обеим платформам: на десктопе — часы дайджеста и окно отправки,
// на Android — выравнивание 60-секундного цикла по границе минуты (next_sleep).
use chrono::{Local, NaiveDateTime, TimeZone, Timelike};
use serde::Deserialize as _;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
#[cfg(target_os = "android")]
use tauri_plugin_notification::{Schedule, ScheduleInterval};

use crate::app_lang;
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
    let mut prefs: NotifyPrefs = serde_json::from_str(&raw).unwrap_or_default();
    sanitize_prefs(&mut prefs);
    prefs
}

/// Привести настройки к допустимым диапазонам. Битый/рукоправленный
/// notify-prefs.json раньше уходил дальше как есть: час вне 0..23 через
/// `as u32` давал u32::MAX — дайджест молча переставал приходить навсегда,
/// а нулевой/отрицательный интервал напоминания либо стрелял ПОСЛЕ начала
/// задачи, либо незаметно отключались все напоминания.
pub fn sanitize_prefs(prefs: &mut NotifyPrefs) {
    prefs.day_summary_hour = prefs.day_summary_hour.clamp(0, 23);
    prefs.remind_minutes.retain(|m| *m > 0);
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

/// Состояние дайджеста, рядом с настройками в отдельном файле:
/// это состояние планировщика, а пользовательские prefs интерфейс
/// перезаписывает целиком — поле-маркер в них терялось бы при каждом
/// сохранении настроек. Десктоп использует только sent_day (переживает
/// перезапуск: иначе дайджест повторялся при каждом запуске в окне +6 ч).
#[derive(Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct DigestState {
    /// День (epoch-day), на который СТОИТ будильник ОС (None — будильника нет).
    #[serde(default)]
    armed_day: Option<i64>,
    /// День, за который дайджест уже показан (догонкой, будильником ОС или
    /// — на десктопе — поллингом).
    #[serde(default)]
    sent_day: Option<i64>,
}

fn digest_state_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    prefs_path(app).with_file_name("notify-digest.json")
}

fn load_digest_state(app: &tauri::AppHandle) -> DigestState {
    let raw = std::fs::read_to_string(digest_state_path(app)).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Атомарно (tmp + rename), как и настройки: обрыв записи не должен
/// превратить маркер в мусор, из-за которого дайджест придёт дважды.
fn save_digest_state(app: &tauri::AppHandle, state: &DigestState) {
    let p = digest_state_path(app);
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let Ok(json) = serde_json::to_string(state) else {
        return;
    };
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &p);
    }
}

/// Новое состояние при перенацеливании будильника на `new_armed`. Если старый
/// будильник стоял на СЕГОДНЯ, а час уже прошёл (`hour_passed`), ОС его уже
/// показала — сегодня считаем отправленным. Без этого первый тик после часа
/// затирал armed_day, и догонка слала второй дайджест (регрессия 0.2.2).
#[cfg(any(target_os = "android", test))]
fn retarget_digest(
    old: &DigestState,
    new_armed: Option<i64>,
    today: i64,
    hour_passed: bool,
) -> DigestState {
    let fired_today = hour_passed && old.armed_day == Some(today);
    DigestState {
        armed_day: new_armed,
        sent_day: if fired_today {
            Some(today)
        } else {
            old.sent_day
        },
    }
}

/// Пора ли показать дайджест «догоняющим» показом. Android-специфика: будильник
/// ставится заранее и только на НЕПУСТОЙ день, поэтому день, спланированный
/// после часа дайджеста, иначе молча остаётся без утреннего списка (на десктопе
/// ту же роль играет окно +6 ч в check_digest). Окно здесь то же — вечером
/// «утренний» список не шлём; has_tasks — чтобы не слать пустой дайджест.
#[cfg(any(target_os = "android", test))]
fn digest_catchup_due(
    now_hour: u32,
    hour: i64,
    today_epoch: i64,
    armed_day: Option<i64>,
    sent_day: Option<i64>,
    has_tasks: bool,
) -> bool {
    let hour = hour.clamp(0, 23) as u32;
    has_tasks
        && armed_day != Some(today_epoch)
        && sent_day != Some(today_epoch)
        && now_hour >= hour
        && now_hour < (hour + 6).min(24)
}

/// Отправленные события: ключ → время отправки (epoch-ms), чтобы не показывать
/// повторно в пределах запуска. Записи старше суток чистятся при каждом тике —
/// иначе кеш растёт бесконечно (каждый день и каждое напоминание добавляют
/// ключ, который больше никогда не удаляется).
/// Только десктоп: на Android используется OS-планирование (sync_scheduled),
/// где повторение исключено самим планировщиком.
/// Окно отправки напоминания на десктопе: сколько минут после due ещё считаем
/// напоминание актуальным (Mac мог спать). Просроченные сильнее не отправляем —
/// напоминание, пришедшее с опозданием на часы, вреднее пропуска.
#[cfg(not(target_os = "android"))]
const REMIND_CATCHUP_MINUTES: i64 = 15;

#[cfg(not(target_os = "android"))]
static FIRED: std::sync::OnceLock<Mutex<HashMap<String, i64>>> = std::sync::OnceLock::new();

#[cfg(not(target_os = "android"))]
fn fired() -> &'static Mutex<HashMap<String, i64>> {
    FIRED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Пометить событие как отправленное. Чистка старых записей — только при
/// разросшемся кеше (retain на каждый тик лишний), поэтому записи старше суток
/// живут до переполнения — ключи содержат дату, коллизий это не даёт.
#[cfg(not(target_os = "android"))]
fn mark_fired(key: String) {
    let now = chrono::Utc::now().timestamp_millis();
    let mut map = fired().lock().unwrap_or_else(|e| e.into_inner());
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
    let mut woken = lock.lock().unwrap_or_else(|e| e.into_inner());
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
        let mut woken = lock.lock().unwrap_or_else(|e| e.into_inner());
        while !*woken {
            let (guard, timeout) = cvar
                .wait_timeout(woken, sleep)
                .unwrap_or_else(|e| e.into_inner());
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
    // 60-с цикл, выровненный по стене минуты: фиксированные «60 с после тика»
    // давали период 60 с + время тика, и сверка с минутными величинами
    // (настройки, дайджест) уползала от границы минуты навсегда.
    let now = chrono::Local::now();
    let elapsed_ms = u64::from(now.second()) * 1000 + u64::from(now.timestamp_subsec_millis());
    Duration::from_millis(60_000_u64.saturating_sub(elapsed_ms).max(1_000))
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
        for (_, _, minutes, date_epoch, travel_time, notify_minutes, travel_notify) in tasks.iter()
        {
            if *notify_minutes == Some(0) {
                continue;
            }
            let Some(start) = task_start(*minutes, *date_epoch) else {
                // «В течение дня»: планировщик должен проснуться к утреннему
                // пингу (см. task_events) — когда дайджест выключен, иначе
                // этот момент никто не рассчитает.
                if !prefs.day_summary {
                    consider(morning_of(*date_epoch, prefs.day_summary_hour));
                }
                continue;
            };
            for rm in task_intervals(*notify_minutes, prefs) {
                consider(Some(due_at(start, rm)));
            }
            if let Some(tt) = travel_time {
                if *tt > 0 {
                    consider(Some(due_at(start, *tt)));
                    if let Some(tn) = travel_notify {
                        if *tn > 0 {
                            consider(Some(due_at(start, *tt + *tn)));
                        }
                    }
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
    let last = widget_day().lock().unwrap_or_else(|e| e.into_inner());
    if *last != today {
        drop(last);
        let state = app.state::<Db>();
        // Тему берём из предыдущей записи виджета: планировщик не знает
        // настройки темы фронтенда (она в localStorage WebView).
        let dark = crate::commands::read_widget_dark(app);
        // Штамп дня — только после успешной записи: при сбое виджет покажет
        // вчерашний список, но попытка повторится на следующем тике.
        if crate::commands::refresh_widget(app, &state, dark).is_ok() {
            *widget_day().lock().unwrap_or_else(|e| e.into_inner()) = today;
        }
    }
    let prefs = load_prefs(app);
    // Android: OS-планирование (уведомления приходят даже при убитом
    // процессе). Сверку гоняем и при обоих выключенных переключателях: только
    // её шаг отмены снимает уже стоящие будильники (повторяющийся дайджест
    // сам себя не отменит и приходил бы вечно).
    #[cfg(target_os = "android")]
    {
        sync_scheduled(app, &prefs);
    }
    // Десктоп: поллинг с окном ±2 мин (процесс жив всегда).
    #[cfg(not(target_os = "android"))]
    {
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
}

// ── Android: планирование на уровне ОС (AlarmManager) ────────────────────

/// NaiveDateTime → DateTime<Local>. Единый для расчёта due, unix-таймстампов
/// и планирования. Точки перехода на летнее время:
///  - неоднозначное время (стрелки назад) — берём раннюю интерпретацию:
///    напоминание придёт на час раньше, а не на час позже;
///  - несуществующее (стрелки вперёд, «дыра») — сдвигаем на час назад к
///    ближайшему валидному моменту. Прежний fallback «интерпретировать как
///    UTC» сдвигал момент на весь сдвиг пояса: будильник на Android и окно
///    отправки на десктопе (сравнивают «наивные» часы) расходились на часы.
fn to_local(dt: &NaiveDateTime) -> chrono::DateTime<Local> {
    match Local.from_local_datetime(dt) {
        chrono::LocalResult::Single(v) => v,
        chrono::LocalResult::Ambiguous(earliest, _) => earliest,
        chrono::LocalResult::None => Local
            .from_local_datetime(&(*dt - chrono::Duration::hours(1)))
            .earliest()
            .unwrap_or_else(|| Local.from_utc_datetime(dt)),
    }
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
        body.push_str(&app_lang::more_tasks(titles.len() - 4));
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
    for row in load_timed_tasks(app) {
        out.extend(task_events(prefs, &row));
    }
    out
}

/// События ОДНОЙ задачи: напоминания по выбранным интервалам + «Пора
/// выезжать»/«Пора собираться». Чистая (без AppHandle) — проверяется тестом.
///
/// Дедуп: общее «Напоминание» в ТА ЖЕ минуту, что «Пора выезжать» или «Пора
/// собираться», не создаётся. Раньше выезд=60 мин при глобальном «за 1 час»
/// давал ДВА уведомления в одну минуту на одну задачу — воспринималось как
/// дубль оповещения. Разные минуты (за 90 мин и выезд за 60) остаются оба.
fn task_events(prefs: &NotifyPrefs, task: &ReminderRow) -> Vec<ReminderEvent> {
    let (task_id, title, minutes, date_epoch, travel_time, notify_minutes, travel_notify) = task;
    let task_id = task_id.as_str();
    let title = title.as_str();
    let minutes = *minutes;
    let date_epoch = *date_epoch;
    let travel_time = *travel_time;
    let notify_minutes = *notify_minutes;
    let travel_notify = *travel_notify;
    let mut out = Vec::new();
    // Своё «не уведомлять» (0) — задачу целиком, включая выезд.
    if notify_minutes == Some(0) {
        return out;
    }
    let Some(m) = minutes else {
        // Задача «в течение дня»: «за N минут до начала» не определено, поэтому
        // единственный осмысленный момент — утро дня задачи (час дайджеста).
        // При включённом дайджесте он и так объявит задачу в тот же час —
        // отдельный пинг задваивал бы утро; без дайджеста это единственное
        // напоминание. Утро уже прошло (задачу добавили днём) — не шлём, как
        // и для задач со временем в прошлом.
        if !prefs.day_summary {
            if let Some(morning) = morning_of(date_epoch, prefs.day_summary_hour) {
                out.push(ReminderEvent {
                    kind: "remind",
                    task_id: task_id.to_string(),
                    due: morning,
                    title: app_lang::remind_title(),
                    body: app_lang::remind_body(title, app_lang::all_day()),
                });
            }
        }
        return out;
    };
    let Some(start) = task_start(Some(m), date_epoch) else {
        return out;
    };
    // Выезд/сборы считаем ПЕРВЫМИ: их моменты — точки, где общее напоминание
    // стало бы дублем.
    let mut other_dues: Vec<NaiveDateTime> = Vec::new();
    if let Some(tt) = travel_time {
        if tt > 0 {
            let dep = due_at(start, tt);
            other_dues.push(dep);
            out.push(ReminderEvent {
                kind: "travel",
                task_id: task_id.to_string(),
                due: dep,
                title: app_lang::travel_title(),
                body: app_lang::travel_body(title, &format!("{:02}:{:02}", m / 60, m % 60)),
            });
            // «Пора собираться»: напомнить за travel_notify минут ДО выезда
            // (выезд = start - tt), т.е. раньше, чем само «пора выезжать».
            if let Some(tn) = travel_notify {
                if tn > 0 {
                    let total_diff = m - tt;
                    let dep = ((total_diff % 1440) + 1440) % 1440;
                    let extra = if total_diff < 0 {
                        app_lang::prev_day()
                    } else {
                        ""
                    };
                    let prep = due_at(start, tt + tn);
                    other_dues.push(prep);
                    out.push(ReminderEvent {
                        kind: "travel_prepare",
                        task_id: task_id.to_string(),
                        due: prep,
                        title: app_lang::prepare_title(),
                        body: app_lang::prepare_body(
                            title,
                            &format!("{:02}:{:02}", dep / 60, dep % 60),
                            extra,
                        ),
                    });
                }
            }
        }
    }
    // Выбранные интервалы напоминаний — каждому своё уведомление, кроме
    // совпадающих по минуте с выездом/сборами.
    for rm in task_intervals(notify_minutes, prefs) {
        let due = due_at(start, rm);
        if other_dues.contains(&due) {
            continue;
        }
        out.push(ReminderEvent {
            kind: "remind",
            task_id: task_id.to_string(),
            due,
            title: app_lang::remind_title(),
            body: app_lang::remind_body(title, &app_lang::format_interval(rm)),
        });
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
#[cfg(any(target_os = "android", test))]
const TASKS_CHANNEL_ID: &str = "tasks";

#[cfg(target_os = "android")]
fn ensure_tasks_channel(app: &tauri::AppHandle) {
    static DONE: std::sync::Once = std::sync::Once::new();
    DONE.call_once(|| {
        use tauri_plugin_notification::{Channel, Importance};
        let _ = app.notification().create_channel(
            Channel::builder(TASKS_CHANNEL_ID, app_lang::channel_name())
                .description(app_lang::channel_desc())
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
    // Диапазон — весь положительный i32, кроме id дайджеста. Прежний модуль
    // 999_999 давал настоящие коллизии (парадокс дней рождения) уже около
    // тысячи запланированных событий, а коллизия = потерянное напоминание.
    let mut id = (h & 0x7fff_ffff) as i32;
    if id == 0 || id == DIGEST_NOTIFICATION_ID {
        id += 1;
    }
    id
}

/// Дата будильника в формате, который разбирает Kotlin-класс плагина
/// (NotificationSchedule.At.date, @JsonFormat JS_DATE_FORMAT). Живёт и в
/// test-сборке: формат проверяется юнит-тестом — ошибка в нём ломает запись в
/// хранилище молча (см. ниже), на устройстве это видно только по пропавшим
/// напоминаниям.
#[cfg(any(target_os = "android", test))]
fn js_date_utc(ts: i64) -> Option<String> {
    // Формат плагина (JS_DATE_FORMAT): yyyy-MM-dd'T'HH:mm:ss.SSS'Z' в UTC.
    // Джексон разбирает эту строку в java.util.Date через SimpleDateFormat с
    // этим шаблоном: без миллисекунд разбор падает, запись молча пропускается и
    // хранилище остаётся пустым (проверено на устройстве 23.09). Собираем строку
    // вручную — крейт time подключён только под android-таргет, а функцию
    // проверяет юнит-тест на десктопе.
    // Импорт внутри функции: трейты нужны только там, где она компилируется
    // (android-сборка и тесты) — иначе clippy ругается на unused import.
    use chrono::{Datelike, Utc};
    let utc = Utc.timestamp_opt(ts, 0).single()?;
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        utc.year(),
        utc.month(),
        utc.day(),
        utc.hour(),
        utc.minute(),
        utc.second(),
        utc.timestamp_subsec_millis()
    ))
}

/// Записать запланированное уведомление в persisted-хранилище плагина
/// уведомлений через наш Kotlin-мост (WidgetPushPlugin.persistScheduled).
///
/// Зачем: `builder().show()` ставит будильник, но в хранилище НЕ пишет (пишет
/// только команда `batch`). С пустым хранилищем `pending()` всегда пуст — guard
/// синхронизации не блокирует перепланирование, лишние будильники не
/// отменяются, а BOOT-приёмник плагина после перезагрузки устройства
/// восстанавливает пустой список (все напоминания и дайджест терялись).
/// Kotlin пишет строку уведомления напрямую в SharedPreferences плагина —
/// jackson/ObjectMapper плагина для этого не нужен.
#[cfg(target_os = "android")]
fn persist_scheduled(app: &tauri::AppHandle, id: i32, notification: serde_json::Value) {
    let Some(state) = app.try_state::<crate::WidgetPush>() else {
        return;
    };
    let Some(handle) = &state.0 else {
        return;
    };
    // Строку собирает Rust, а не плагин: Notification.sourceJson в 2.3.3 не
    // заполняется нигде (в Kotlin поле только читается, Rust его не передаёт),
    // поэтому `batch`-путь плагина кладёт в хранилище строку "null" — restore
    // после перезагрузки и чтение списка отложенных не работают.
    let payload = serde_json::json!({ "id": id, "json": notification.to_string() });
    // Sync-вызов допустим: планировщик живёт в своём потоке (дедлок sync-
    // варианта — только при вызове с главного).
    if let Err(e) = handle.run_mobile_plugin::<i32>("persistScheduled", payload) {
        eprintln!("[notify] persistScheduled не удался: {e}");
        return;
    }
    // Самопроверка записи: если её нет в хранилище, restore после перезагрузки
    // молча ничего не восстановит, а список отложенных не увидит аларм — лучше
    // увидеть это в логе сразу (на устройстве 23.09 так нашлась пустая запись).
    if !scheduled_ids(app).contains(&id) {
        eprintln!("[notify] запись {id} не появилась в хранилище плагина");
    }
}

/// JSON записи для persisted-хранилища плагина. Живёт и в test-сборке: состав
/// полей — контракт с Kotlin-классом Notification (jackson падает на неизвестном
/// поле, а JSObject из extra разобрать не умеет — тогда запись целиком
/// пропускается и хранилище пустеет). Проверяется юнит-тестом.
#[cfg(any(target_os = "android", test))]
fn scheduled_json(
    id: i32,
    title: &str,
    body: Option<&str>,
    large_body: Option<&str>,
    inbox_lines: Option<&[String]>,
    summary: Option<&str>,
    schedule: serde_json::Value,
) -> serde_json::Value {
    let mut n = serde_json::json!({
        "id": id,
        "channelId": TASKS_CHANNEL_ID,
        "title": title,
        "schedule": schedule,
    });
    if let Some(v) = body {
        n["body"] = serde_json::json!(v);
    }
    if let Some(v) = large_body {
        n["largeBody"] = serde_json::json!(v);
    }
    if let Some(v) = inbox_lines {
        n["inboxLines"] = serde_json::json!(v);
    }
    if let Some(v) = summary {
        n["summary"] = serde_json::json!(v);
    }
    n
}

/// Расписание одноразового напоминания (At): точный момент в формате плагина.
#[cfg(any(target_os = "android", test))]
fn at_schedule(date: &str) -> serde_json::Value {
    serde_json::json!({ "at": {
        "date": date, "repeating": false, "allowWhileIdle": true,
    }})
}

/// Расписание утреннего дайджеста (Interval): «каждый день в hour:00».
/// Двойная вложенность interval.interval — контракт Kotlin-десериализатора
/// плагина 2.3.3: внешний ключ выбирает вариант At/Interval/Every, внутренний —
/// это DateMatch (поля hour/minute; Timezone — локальная, Calendar). После
/// каждого срабатывания publisher перепланирует его сам (CRON_KEY →
/// nextTrigger: если «сегодня hour:00» уже прошло — сдвиг на сутки).
#[cfg(any(target_os = "android", test))]
fn interval_schedule(hour: u8) -> serde_json::Value {
    // Поля перечислены ВСЕ (с null), как их сериализует печатный
    // ScheduleInterval, — тест interval_schedule_matches_typed_enum держит
    // обе формы равными байт-в-байт.
    serde_json::json!({ "interval": {
        "interval": {
            "year": null, "month": null, "day": null, "weekday": null,
            "hour": hour, "minute": 0, "second": null,
        },
        "allowWhileIdle": true,
    }})
}

/// Id уведомлений, лежащих в persisted-хранилище плагина, — это и есть
/// поставленные алармы: publisher удаляет запись при срабатывании, cancel — при
/// отмене. `pending()` плагина для этого не годится (см. sync_scheduled).
#[cfg(target_os = "android")]
fn scheduled_ids(app: &tauri::AppHandle) -> Vec<i32> {
    let Some(state) = app.try_state::<crate::WidgetPush>() else {
        return Vec::new();
    };
    let Some(handle) = &state.0 else {
        return Vec::new();
    };
    match handle.run_mobile_plugin::<Vec<i32>>("scheduledIds", ()) {
        Ok(ids) => ids,
        // Пустой ответ безопаснее отказа: планировщик переставит всё заново.
        Err(e) => {
            eprintln!("[notify] хранилище уведомлений недоступно: {e}");
            Vec::new()
        }
    }
}

/// Запланировать уведомление на момент `due` (локальное время): AlarmManager
/// доставит его, даже если процесс приложения убит. Канал — TASKS_CHANNEL_ID
/// (высокая важность: звук и heads-up).
///
/// Будильник ставит проверенный путь плагина (`show()`), а запись в его
/// persisted-хранилище — наш мост (см. persist_scheduled). Форма JSON повторяет
/// сериализацию NotificationData плагина — сверять при обновлении плагина.
#[cfg(target_os = "android")]
fn schedule_at(
    app: &tauri::AppHandle,
    id: i32,
    task_id: &str,
    title: &str,
    body: &str,
    due: NaiveDateTime,
) {
    // Абсолютный момент в unix-секундах — смещение часового пояса в ISO-строке
    // плагину не нужно: Kotlin ставит будильник по миллисекундам.
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
        // large_body → BigTextStyle: уведомление разворачивается и показывает
        // полный текст целиком, а не одну строку (по умолчанию body в Android
        // обрезается).
        .large_body(body)
        .channel_id(TASKS_CHANNEL_ID)
        // taskId в extra — фронт читает его в событии «actionPerformed» и
        // открывает карточку задачи по тапу на уведомление (deep-link).
        .extra("taskId", task_id)
        .schedule(Schedule::At {
            date: at,
            repeating: false,
            allow_while_idle: true,
        })
        .show()
        .inspect_err(|e| eprintln!("[notify] напоминание {id} не спланировано: {e}"));
    // Запись в хранилище — только после успешного show(): при сбое будильника
    // запись сделала бы sync считать напоминание поставленным навсегда
    // (симптом «уведомления молча не приходят»); следующий тик повторит.
    if let Some(date) = js_date_utc(ts) {
        // taskId (extra) в запись не кладём — см. scheduled_json: после
        // перезагрузки напоминание восстановится без deep-link, а id задачи
        // вернётся при следующем запуске приложения.
        persist_scheduled(
            app,
            id,
            scheduled_json(
                id,
                title,
                Some(body),
                Some(body),
                None,
                None,
                at_schedule(&date),
            ),
        );
    }
}

/// Дайджест «План на день»: InboxStyle-уведомление — каждая задача строкой.
/// Задачи с временем — «09:00  Название» (сортировка по времени), без времени —
/// пунктиром «• Название» в конце (сначала по расписанию, потом «в течение дня»).
/// В развёрнутом виде — весь список, в сводке — сколько задач со временем.
///
/// Заголовок/сводка/строки дайджеста — общие для постановки будильника
/// (schedule_digest) и разового показа (show_digest_now).
#[cfg(target_os = "android")]
fn digest_parts(day_epoch: i64, rows: &[(String, Option<i64>)]) -> (String, String, Vec<String>) {
    let timed = rows.iter().filter(|(_, t)| t.is_some()).count();
    let lines: Vec<String> = rows
        .iter()
        .map(|(title, time)| match time {
            Some(m) => format!("{:02}:{:02}  {}", m / 60, m % 60, title),
            None => format!("• {title}"),
        })
        .collect();
    let title = app_lang::plan_title(rows.len());
    let summary = if timed == 0 {
        app_lang::all_day().to_string()
    } else {
        app_lang::timed_summary(timed)
    };
    // Повторяющийся будильник ОС несёт текст момента постановки: без запусков
    // приложения он показывает тот же список каждый день — дата это выдаёт.
    let summary = match crate::commands::epoch_to_date(day_epoch) {
        Some(d) => format!("{} · {summary}", app_lang::short_date(d)),
        None => summary,
    };
    (title, summary, lines)
}

/// Планируется как Interval («каждый день в hour:00»), а не одноразовый At:
/// ОС перепланирует следующий день сама после каждого срабатывания и после
/// перезагрузки. С 0.2.2 дайджест не зависит от этой цепочки: день, которому
/// будильник не достался, добирается «догоняющим» показом (digest_catchup_due).
/// Контент дня обновляет sync-цикл (см. sync_scheduled). Возвращает успех:
/// false — будильник НЕ поставлен (запись в хранилище не пишем, чтобы sync
/// не считал дайджест активным).
#[cfg(target_os = "android")]
fn schedule_digest(
    app: &tauri::AppHandle,
    hour: u8,
    day_epoch: i64,
    rows: &[(String, Option<i64>)],
) -> bool {
    let (title, summary, lines) = digest_parts(day_epoch, rows);
    let mut b = app
        .notification()
        .builder()
        .id(DIGEST_NOTIFICATION_ID)
        .title(title.clone())
        .summary(summary.clone())
        .channel_id(TASKS_CHANNEL_ID)
        .schedule(Schedule::Interval {
            interval: ScheduleInterval {
                hour: Some(hour),
                minute: Some(0),
                ..Default::default()
            },
            allow_while_idle: true,
        });
    for line in &lines {
        b = b.inbox_line(line.clone());
    }
    if let Err(e) = b.show() {
        // Проглоченная ошибка здесь = дайджест молча не приходит, а sync
        // считает его поставленным (запись в хранилище есть). Лог + отказ
        // от записи: следующий тик повторит попытку.
        eprintln!("[notify] дайджест не спланирован: {e}");
        return false;
    }
    persist_scheduled(
        app,
        DIGEST_NOTIFICATION_ID,
        scheduled_json(
            DIGEST_NOTIFICATION_ID,
            &title,
            None,
            None,
            Some(&lines),
            Some(&summary),
            interval_schedule(hour),
        ),
    );
    true
}

/// Показать дайджест СЕЙЧАС, без расписания: день спланировали уже после часа
/// дайджеста (или будильник на этот день не ставился) — будильник задним
/// числом не поставить, а список на день нужен. Настройки/хранилище расписаний
/// не трогаем: это разовый показ, а не арм-запись.
#[cfg(target_os = "android")]
fn show_digest_now(app: &tauri::AppHandle, day_epoch: i64, rows: &[(String, Option<i64>)]) -> bool {
    let (title, summary, lines) = digest_parts(day_epoch, rows);
    let mut b = app
        .notification()
        .builder()
        .id(DIGEST_NOTIFICATION_ID)
        .title(title)
        .summary(summary)
        .channel_id(TASKS_CHANNEL_ID);
    for line in &lines {
        b = b.inbox_line(line.clone());
    }
    if let Err(e) = b.show() {
        eprintln!("[notify] догоняющий дайджест не показан: {e}");
        return false;
    }
    true
}

/// Что делать с алармом дайджеста в этом тике. Чистая логика (живёт под
/// `test` тоже) — синхронизацию на Android иначе нечем проверить.
#[cfg(any(target_os = "android", test))]
#[derive(Debug, PartialEq, Eq)]
enum DigestAction {
    /// Поставить аларм: его нет, сменился день или изменился контент.
    Schedule,
    /// Аларм стоит с тем же контентом — не трогаем (JNI + запись хранилища).
    Keep,
    /// День пуст — аларм не нужен (снимет шаг «отмена лишних»).
    Cancel,
}

#[cfg(any(target_os = "android", test))]
fn digest_action(
    pending: bool,
    armed: Option<(i64, u64)>,
    target: (i64, u64),
    has_tasks: bool,
) -> DigestAction {
    if !has_tasks {
        return DigestAction::Cancel;
    }
    if !pending || armed != Some(target) {
        DigestAction::Schedule
    } else {
        DigestAction::Keep
    }
}

/// Отпечаток контента дайджеста (день + строки задач): им отличаем «тот же
/// дайджест» от «задачи поменялись».
#[cfg(target_os = "android")]
fn digest_fingerprint(target_epoch: i64, tasks: &[(String, Option<i64>)]) -> u64 {
    use std::fmt::Write as _;
    let mut buf = target_epoch.to_string();
    for (title, time) in tasks {
        let _ = write!(buf, "\n{time:?}|{title}");
    }
    crate::commands::fnv64(buf.as_bytes())
}

/// Ячейка «с каким контентом дайджест ушёл в OS-планировщик». Пусто —
/// неизвестно (первый тик после запуска процесса): тогда аларм перезапишется
/// текущим контентом, операция идемпотентна (show() снимает старый аларм).
#[cfg(target_os = "android")]
fn armed_cell() -> &'static Mutex<Option<(i64, u64)>> {
    static ARMED: std::sync::OnceLock<Mutex<Option<(i64, u64)>>> = std::sync::OnceLock::new();
    ARMED.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "android")]
fn digest_armed() -> Option<(i64, u64)> {
    *armed_cell().lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(target_os = "android")]
fn set_digest_armed(v: Option<(i64, u64)>) {
    *armed_cell().lock().unwrap_or_else(|e| e.into_inner()) = v;
}

/// Android: сверка OS-планировщика с ожидаемыми уведомлениями.
///
/// Модель «sync»: каждый тик сравниваем уже поставленные алармы с тем, что
/// должно быть запланировано. Недостающие ставим на момент due, лишние
/// отменяем (задача выполнена, удалена, время изменено). Список поставленных
/// берём из persisted-хранилища плагина: наш мост пишет туда запись на каждый
/// show, publisher удаляет её при срабатывании, cancel — при отмене.
///
/// Плагинный `pending()` для этого НЕ годится: его Kotlin-реализация
/// (getPending) отдаёт `NotificationManager.activeNotifications` — уведомления,
/// уже висящие в шторке. До первого срабатывания список пуст, поэтому guard
/// ничего не блокировал (лишние перепланирования + JNI на каждом тике), а
/// «отмена лишних» не отменяла ничего (проверено на устройстве 23.09.2026).
#[cfg(target_os = "android")]
fn sync_scheduled(app: &tauri::AppHandle, prefs: &NotifyPrefs) {
    let notif = app.notification();
    let scheduled: HashSet<i32> = scheduled_ids(app).into_iter().collect();
    let mut expected: HashSet<i32> = HashSet::new();
    let now = Local::now().naive_local();

    // 1. Утренний дайджест — повторяющийся Interval-аларм «каждый день в
    // настроенный час»: ОС перепланирует его сама после каждого срабатывания
    // и после перезагрузки, поэтому он не зависит от запусков приложения.
    // Наша роль — держать КОНТЕНТ дня свежим: отпечаток дня пересчитывается
    // каждый тик, при изменении задач аларм перезаписывается (show() снимает
    // старый), при пустом дне — снимается. Запрос дня дешёвый (индекс
    // idx_tasks_date_active), JNI-вызов + запись хранилища — только при
    // реальном изменении.
    if prefs.day_summary {
        let now_date = Local::now().date_naive();
        let today_epoch = crate::commands::today_epoch_day();
        let today_ts = now_date.and_hms_opt(prefs.day_summary_hour as u32, 0, 0);
        let target_epoch = if today_ts.is_some_and(|ts| ts > now) {
            Some(today_epoch)
        } else {
            now_date
                .checked_add_days(chrono::Days::new(1))
                .map(crate::commands::date_to_epoch)
        };
        if let Some(target_epoch) = target_epoch {
            let tasks = day_task_rows(app, target_epoch);
            let fp = digest_fingerprint(target_epoch, &tasks);
            let action = digest_action(
                scheduled.contains(&DIGEST_NOTIFICATION_ID),
                digest_armed(),
                (target_epoch, fp),
                !tasks.is_empty(),
            );
            match action {
                DigestAction::Schedule => {
                    let hour = u8::try_from(prefs.day_summary_hour).unwrap_or(8);
                    if schedule_digest(app, hour, target_epoch, &tasks) {
                        expected.insert(DIGEST_NOTIFICATION_ID);
                        set_digest_armed(Some((target_epoch, fp)));
                        // Маркер: будильник на этот день уже стоит — догоняющий
                        // показ в этот день не нужен (иначе второй дайджест).
                        save_digest_state(
                            app,
                            &retarget_digest(
                                &load_digest_state(app),
                                Some(target_epoch),
                                today_epoch,
                                target_epoch != today_epoch,
                            ),
                        );
                    }
                    // При отказе планирования НЕ добавляем в expected и не
                    // ставим armed: cancel-шаг снимет протухшую запись,
                    // следующий тик повторит попытку.
                }
                DigestAction::Keep => {
                    expected.insert(DIGEST_NOTIFICATION_ID);
                }
                DigestAction::Cancel => {
                    set_digest_armed(None);
                    // Пустой день: будильника на него нет — снимаем маркер,
                    // чтобы «догонка» сработала, когда в дне появятся задачи.
                    save_digest_state(
                        app,
                        &retarget_digest(
                            &load_digest_state(app),
                            None,
                            today_epoch,
                            target_epoch != today_epoch,
                        ),
                    );
                }
            }
        }
        // Догоняющий показ (см. digest_catchup_due): час дайджеста прошёл, у
        // дня есть задачи, а будильника/показа на этот день не было — день
        // спланировали уже после часа, и без этой ветки он молча остаётся без
        // утреннего списка.
        let today_rows = day_task_rows(app, today_epoch);
        let state = load_digest_state(app);
        if digest_catchup_due(
            now.hour(),
            prefs.day_summary_hour,
            today_epoch,
            state.armed_day,
            state.sent_day,
            !today_rows.is_empty(),
        ) && show_digest_now(app, today_epoch, &today_rows)
        {
            save_digest_state(
                app,
                &DigestState {
                    armed_day: state.armed_day,
                    sent_day: Some(today_epoch),
                },
            );
        }
    }

    // 2. Напоминания задач (глобальные интервалы / своё notify_minutes /
    // travel_time «Пора выезжать»). Расчёт событий общий с десктопом
    // (reminder_events) — здесь только планирование на уровне ОС.
    // taskId → id будильников: по этой карте виджет (Kotlin) снимает
    // напоминания задачи, отмеченной выполненной при убитом процессе.
    let mut by_task: std::collections::BTreeMap<String, Vec<i32>> = Default::default();
    if prefs.reminders {
        for ev in reminder_events(app, prefs) {
            // Горизонт: строго в будущем и в пределах выборки (+7 дней) —
            // просроченные не планируем, слишком далёкие не достаём.
            if ev.due <= now || ev.due > now + chrono::Duration::days(7) {
                continue;
            }
            let nid = stable_id(ev.kind, &ev.task_id, due_unix_minute(ev.due));
            expected.insert(nid);
            by_task.entry(ev.task_id.clone()).or_default().push(nid);
            if !scheduled.contains(&nid) {
                schedule_at(app, nid, &ev.task_id, ev.title, &ev.body, ev.due);
            }
        }
    }

    write_task_alarm_map(app, &by_task);

    // 3. Отмена лишних: запланированные, но не ожидаемые — задача выполнена,
    // удалена или её время изменилось (id у нового due другой).
    for id in scheduled {
        if !expected.contains(&id) {
            let _ = notif.cancel(vec![id]);
        }
    }
}

/// files/notify-tasks.json для виджета: {"<taskId>": [id, …]}. Пишем только при
/// изменении (тик раз в 60 с), атомарно — Kotlin читает файл без блокировок.
#[cfg(target_os = "android")]
fn write_task_alarm_map(
    app: &tauri::AppHandle,
    map: &std::collections::BTreeMap<String, Vec<i32>>,
) {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let Ok(json) = serde_json::to_string(map) else {
        return;
    };
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if *last == json {
        return;
    }
    let dir = crate::commands::app_files_dir(app);
    let tmp = dir.join("notify-tasks.json.tmp");
    if std::fs::write(&tmp, &json).is_ok()
        && std::fs::rename(&tmp, dir.join("notify-tasks.json")).is_ok()
    {
        *last = json;
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

/// Строки невыполненных задач на указанную дату (epoch-day): заголовок + время.
fn day_task_rows(app: &tauri::AppHandle, date_epoch: i64) -> Vec<(String, Option<i64>)> {
    let db = app.state::<Db>();
    let conn = db.lock();
    conn.prepare(
      "SELECT title, time_minutes FROM tasks WHERE date = ?1 AND is_done = 0 AND archived = 0 AND someday = 0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, sort_order ASC, created_at ASC",
    )
    .and_then(|mut stmt| {
        stmt.query_map([date_epoch], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
        })
        .and_then(|it| it.collect::<Result<Vec<_>, _>>())
    })
    .unwrap_or_default()
}

/// Строки невыполненных задач на сегодня: заголовок + время. Порядок — как
/// в виджете: сначала задачи с временем (по времени), затем без.
#[cfg(not(target_os = "android"))]
fn today_task_rows(app: &tauri::AppHandle) -> Vec<(String, Option<i64>)> {
    day_task_rows(app, crate::commands::today_epoch_day())
}

/// Утренний дайджест (десктоп): в назначенный час (или в течение первой половины дня,
/// если Mac проснулся позже назначенного часа) — задачи на сегодня.
#[cfg(not(target_os = "android"))]
fn check_digest(app: &tauri::AppHandle, prefs: &NotifyPrefs, now: NaiveDateTime) {
    let target_hour = prefs.day_summary_hour as u32;
    // Срабатывает в назначенный час или в течение 6 часов после (если ноутбук
    // спал в час дайджеста). Окно считается от настроенного часа: при часе ≥ 14
    // у захардкоженной границы «до 14:00» дайджест молча не приходил никогда.
    let window_end = (target_hour + 6).min(24);
    if now.hour() < target_hour || now.hour() >= window_end {
        return;
    }
    let today_epoch = crate::commands::date_to_epoch(now.date());
    let state = load_digest_state(app);
    if state.sent_day == Some(today_epoch) {
        return;
    }

    let tasks = today_titles(app);

    if tasks.is_empty() {
        // Пустой день НЕ отмечаем как «отправлено»: задача, добавленная позже
        // в окне отправки, ещё должна получить дайджест (раньше такой день
        // молча оставался без него). Спама нет — отметка ставится только при
        // реальной отправке.
        return;
    }

    let body = digest_body(&tasks);

    let _ = app
        .notification()
        .builder()
        .title(app_lang::digest_title(tasks.len()))
        .body(body)
        .show();

    save_digest_state(
        app,
        &DigestState {
            sent_day: Some(today_epoch),
            ..state
        },
    );
}

/// Строка задачи с полями, нужными для расчёта напоминания.
type ReminderRow = (
    String,
    String,
    Option<i64>, // time_minutes: None = «в течение дня»
    i64,
    Option<i64>,
    Option<i64>,
    Option<i64>,
);

/// Задачи со временем в горизонте (сегодня..+7 дней) для расчёта напоминаний.
/// +7 дней покрывает глобальные интервалы и свои notify_minutes до 7 суток
/// (настройка «Уведомить» позволяет напоминать за неделю).
fn load_timed_tasks(app: &tauri::AppHandle) -> Vec<ReminderRow> {
    let today_epoch = crate::commands::today_epoch_day();
    let horizon_epoch = today_epoch + 7;
    let db = app.state::<Db>();
    let conn = db.lock();
    let mut stmt = match conn.prepare(
      "SELECT id, title, time_minutes, date, travel_time, notify_minutes, travel_notify_minutes FROM tasks WHERE date BETWEEN ?1 AND ?2 AND is_done = 0 AND archived = 0 AND someday = 0",
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
            r.get::<_, Option<i64>>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, Option<i64>>(4)?,
            r.get::<_, Option<i64>>(5)?,
            r.get::<_, Option<i64>>(6)?,
        ))
    })
    .and_then(|it| it.collect::<Result<Vec<_>, _>>())
    .unwrap_or_default()
}

/// Интервалы напоминаний задачи: своё notify_minutes (N>0) перекрывает
/// глобальные настройки; 0 отфильтровывается вызывающим (задачу не уведомлять).
/// Свои интервалы напоминаний задачи: положительное значение перекрывает
/// общие, 0 и отрицательные — «не напоминать» (раньше отрицательное значение
/// молча уходило в общие интервалы, а отрицательный интервал стрелял ПОСЛЕ
/// начала задачи), None — общие интервалы из настроек.
fn task_intervals(notify_minutes: Option<i64>, prefs: &NotifyPrefs) -> Vec<i64> {
    match notify_minutes {
        Some(n) if n > 0 => vec![n],
        Some(_) => Vec::new(),
        None => prefs.remind_minutes.clone(),
    }
}

/// Начало задачи (локальная дата + время) — Option при некорректных данных.
fn task_start(minutes: Option<i64>, date_epoch: i64) -> Option<NaiveDateTime> {
    let minutes = minutes?;
    let h = (minutes / 60) as u32;
    let m = (minutes % 60) as u32;
    let task_date = crate::commands::epoch_to_date(date_epoch)?;
    task_date.and_hms_opt(h, m, 0)
}

/// Утро дня задачи (локальная дата + час дайджеста) — момент напоминания для
/// задач «в течение дня». Option при некорректной дате.
fn morning_of(date_epoch: i64, hour: i64) -> Option<NaiveDateTime> {
    crate::commands::epoch_to_date(date_epoch)?.and_hms_opt(hour.clamp(0, 23) as u32, 0, 0)
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
        // Окно отправки: до REMIND_CATCHUP_MINUTES после due (см. константу).
        if now < ev.due || now > ev.due + chrono::Duration::minutes(REMIND_CATCHUP_MINUTES) {
            continue;
        }
        // shortcut: дедуп в памяти — перезапуск в пределах REMIND_CATCHUP_MINUTES
        // повторит напоминание; хранить на диске, если перезапуски станут частыми.
        // Ключ дедупликации: id + момент due достаточны — разные интервалы
        // одной задачи дают разные due (разница ≥ 1 мин), коллизий нет.
        let key = if ev.kind == "travel" {
            format!("remind|travel|{}|{}", ev.task_id, ev.due)
        } else if ev.kind == "travel_prepare" {
            format!("remind|travel_prepare|{}|{}", ev.task_id, ev.due)
        } else {
            format!("remind|{}|{}", ev.task_id, ev.due)
        };
        if fired()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&key)
        {
            continue;
        }
        let _ = app
            .notification()
            .builder()
            .title(ev.title)
            .body(ev.body)
            .extra("taskId", &ev.task_id)
            .show();
        mark_fired(key);
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;
    use chrono::{Datelike, NaiveDate};

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
            Some(minutes),
            date_epoch,
            None,
            notify,
            None,
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

    /// «Пора собираться» учитывается при расчёте ближайшего события: при
    /// travel=30 и travel_notify=15 ближайшее будущее напоминание — за 45 мин
    /// до начала задачи (09:15), раньше и «пора выезжать» (09:30).
    #[test]
    fn next_event_considers_travel_prepare() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 16)
            .unwrap()
            .and_hms_opt(8, 0, 0)
            .unwrap();
        let date_epoch = NaiveDate::from_ymd_opt(2026, 8, 16)
            .unwrap()
            .num_days_from_ce() as i64
            - 719163;
        let task: ReminderRow = (
            "t1".into(),
            "Задача".into(),
            Some(600), // 10:00
            date_epoch,
            Some(30), // travel_time
            None,     // notify_minutes → глобальные
            Some(15), // travel_notify_minutes
        );
        let ev = next_event_from(&prefs(false, true, vec![1440]), &[task], now);
        assert_eq!(
            ev,
            NaiveDate::from_ymd_opt(2026, 8, 16)
                .unwrap()
                .and_hms_opt(9, 15, 0)
                .unwrap()
        );
    }

    /// Задача «в течение дня» при выключенном дайджесте: одно напоминание
    /// утром дня задачи (в час дайджеста). Раньше такие задачи молча не
    /// напоминали вовсе, хотя карточка обещала «По умолчанию (из настроек)».
    #[test]
    fn all_day_task_reminds_in_the_morning() {
        let p = prefs(false, true, vec![60]);
        let date_epoch = NaiveDate::from_ymd_opt(2026, 8, 16)
            .unwrap()
            .num_days_from_ce() as i64
            - 719163;
        let row: ReminderRow = (
            "t1".into(),
            "Задача".into(),
            None, // «в течение дня»
            date_epoch,
            None,
            None,
            None,
        );
        let evs = task_events(&p, &row);
        assert_eq!(evs.len(), 1, "должен быть один утренний пинг");
        assert_eq!(evs[0].kind, "remind");
        assert_eq!(
            evs[0].due,
            NaiveDate::from_ymd_opt(2026, 8, 16)
                .unwrap()
                .and_hms_opt(8, 0, 0)
                .unwrap()
        );
    }

    /// С включённым дайджестом отдельного пинга нет: дайджест в тот же час и
    /// так объявляет задачу — два уведомления в одну минуту задваивали утро.
    #[test]
    fn all_day_task_skipped_when_digest_on() {
        let p = prefs(true, true, vec![60]);
        let date_epoch = NaiveDate::from_ymd_opt(2026, 8, 16)
            .unwrap()
            .num_days_from_ce() as i64
            - 719163;
        let row: ReminderRow = (
            "t1".into(),
            "Задача".into(),
            None,
            date_epoch,
            None,
            None,
            None,
        );
        assert!(task_events(&p, &row).is_empty());
    }

    /// «Не уведомлять» (notify_minutes = 0) глушит и утренний пинг задачи
    /// без времени.
    #[test]
    fn all_day_task_notify_off_is_silent() {
        let p = prefs(false, true, vec![60]);
        let date_epoch = NaiveDate::from_ymd_opt(2026, 8, 16)
            .unwrap()
            .num_days_from_ce() as i64
            - 719163;
        let row: ReminderRow = (
            "t1".into(),
            "Задача".into(),
            None,
            date_epoch,
            None,
            Some(0), // «не уведомлять»
            None,
        );
        assert!(task_events(&p, &row).is_empty());
    }

    /// Запись для persisted-хранилища плагина: только поля его Kotlin-класса
    /// Notification и никакого `extra` (JSObject jackson не разбирает, и вся
    /// запись пропускается — так хранилище осталось пустым на устройстве).
    /// Формы расписания: At (напоминание, точная дата) и Interval (дайджест,
    /// «каждый день в час:00») — обе обязанны разбираться jackson-ом плагина.
    #[test]
    fn persisted_json_matches_plugin_fields() {
        let fields = [
            "id",
            "title",
            "body",
            "largeBody",
            "summary",
            "sound",
            "icon",
            "largeIcon",
            "iconColor",
            "actionTypeId",
            "group",
            "inboxLines",
            "isGroupSummary",
            "isOngoing",
            "isAutoCancel",
            "extra",
            "attachments",
            "schedule",
            "channelId",
            "sourceJson",
            "visibility",
            "number",
        ];
        let lines = vec!["09:00  Задача".to_string()];
        // Дайджест: Interval с ДВОЙНОЙ вложенностью interval.interval —
        // внешний ключ выбирает вариант расписания в NotificationSchedule-
        // десериализаторе, внутренний — это DateMatch (hour/minute).
        let v = scheduled_json(
            1,
            "План на сегодня: 1 задача",
            None,
            None,
            Some(&lines),
            Some("в течение дня"),
            interval_schedule(8),
        );
        for key in v.as_object().expect("object").keys() {
            assert!(
                fields.contains(&key.as_str()),
                "поля {key} нет в Kotlin-классе Notification плагина"
            );
        }
        assert!(
            v.get("extra").is_none(),
            "extra ломает разбор записи jackson-ом"
        );
        assert_eq!(v["id"], 1);
        assert_eq!(v["channelId"], TASKS_CHANNEL_ID);
        assert_eq!(v["inboxLines"][0], "09:00  Задача");
        assert_eq!(v["schedule"]["interval"]["allowWhileIdle"], true);
        assert_eq!(v["schedule"]["interval"]["interval"]["hour"], 8);
        assert_eq!(v["schedule"]["interval"]["interval"]["minute"], 0);
        // Минимальный набор (напоминание, At) тоже валиден.
        let r = scheduled_json(
            2,
            "Напоминание",
            Some("B"),
            Some("B"),
            None,
            None,
            at_schedule("2026-09-24T19:00:00.000Z"),
        );
        assert_eq!(r["largeBody"], "B");
        assert!(r.get("summary").is_none());
        assert_eq!(r["schedule"]["at"]["date"], "2026-09-24T19:00:00.000Z");
        assert_eq!(r["schedule"]["at"]["repeating"], false);
        assert_eq!(r["schedule"]["at"]["allowWhileIdle"], true);
    }

    /// Дата для persisted-хранилища плагина: UTC, миллисекунды, суффикс Z —
    /// ровно шаблон JS_DATE_FORMAT. Без миллисекунд SimpleDateFormat плагина
    /// не разбирает строку: запись молча пропускается, хранилище остаётся
    /// пустым (нет ни restore после перезагрузки, ни списка отложенных).
    #[test]
    fn js_date_is_plugin_format() {
        assert_eq!(
            js_date_utc(1_800_000_000).as_deref(),
            Some("2027-01-15T08:00:00.000Z")
        );
        assert_eq!(
            js_date_utc(1_790_190_000).as_deref(),
            Some("2026-09-23T19:00:00.000Z")
        );
        assert_eq!(js_date_utc(i64::MAX), None);
    }

    /// JSON печатного Schedule::Interval (этим путём ставится будильник) и
    /// рука собранная запись interval_schedule (этим путём пишется хранилище)
    /// обязаны совпадать байт-в-байт: расхождение форм = будильник одного
    /// вида, а запись другого (после перезагрузки restore восстановит не то).
    /// Двойная вложенность interval.interval — контракт Kotlin-десериализатора
    /// (внешний ключ = вариант At/Interval/Every, внутренний = DateMatch).
    #[test]
    fn interval_schedule_matches_typed_enum() {
        use tauri_plugin_notification::{Schedule, ScheduleInterval};
        let typed = serde_json::to_value(Schedule::Interval {
            interval: ScheduleInterval {
                hour: Some(8),
                minute: Some(0),
                ..Default::default()
            },
            allow_while_idle: true,
        })
        .expect("serialize");
        assert_eq!(typed, interval_schedule(8));
        // Нулевой час не должен потеряться (0:00 — валидное время дайджеста).
        let midnight = serde_json::to_value(Schedule::Interval {
            interval: ScheduleInterval {
                hour: Some(0),
                minute: Some(0),
                ..Default::default()
            },
            allow_while_idle: true,
        })
        .expect("serialize");
        assert_eq!(midnight, interval_schedule(0));
        assert_eq!(midnight["interval"]["interval"]["hour"], 0);
    }

    /// Переход состояния после часа дайджеста: будильник на сегодня уже
    /// сработал, тик перенацеливает его на завтра — догонка НЕ должна слать
    /// второй дайджест. До часа (пустой день → Cancel) сегодня не помечается,
    /// чтобы задачи, добавленные позже, ещё получили догонку.
    #[test]
    fn digest_retarget_marks_fired_day() {
        let armed_today = DigestState {
            armed_day: Some(100),
            sent_day: None,
        };
        let s = retarget_digest(&armed_today, Some(101), 100, true);
        assert_eq!(
            s,
            DigestState {
                armed_day: Some(101),
                sent_day: Some(100)
            }
        );
        assert!(!digest_catchup_due(
            9,
            8,
            100,
            s.armed_day,
            s.sent_day,
            true
        ));
        // Завтра пустое (Cancel) после часа — сегодня тоже показано.
        let s = retarget_digest(&armed_today, None, 100, true);
        assert_eq!(s.sent_day, Some(100));
        // До часа: сегодняшний день опустел → будильник снят, не показан.
        let s = retarget_digest(&armed_today, None, 100, false);
        assert_eq!(
            s,
            DigestState {
                armed_day: None,
                sent_day: None
            }
        );
        assert!(digest_catchup_due(9, 8, 100, s.armed_day, s.sent_day, true));
        // Будильника на сегодня не было — день не помечается (догонка нужна).
        let none = DigestState {
            armed_day: Some(99),
            sent_day: Some(99),
        };
        let s = retarget_digest(&none, Some(101), 100, true);
        assert_eq!(s.sent_day, Some(99));
        assert!(digest_catchup_due(9, 8, 100, s.armed_day, s.sent_day, true));
    }

    /// Догоняющий дайджест нужен ровно тогда, когда час прошёл (в пределах
    /// окна +6 ч), в дне есть задачи, а будильника на этот день не стояло и
    /// показа не было. Ошибка здесь = либо молчание (жалоба «не вылезает»),
    /// либо второй дайджест в день срабатывания будильника.
    #[test]
    fn digest_catchup_decision() {
        // 9:00, час 8, задачи есть, ни будильника, ни показа на сегодня.
        assert!(digest_catchup_due(9, 8, 100, None, None, true));
        // Будильник на сегодня стоит — он и сработает, догонять нечего.
        assert!(!digest_catchup_due(9, 8, 100, Some(100), None, true));
        // Догонка уже показала дайджест сегодня.
        assert!(!digest_catchup_due(9, 8, 100, None, Some(100), true));
        // Пустой день — молчим (как и у дайджеста по расписанию).
        assert!(!digest_catchup_due(9, 8, 100, None, None, false));
        // Час ещё не наступил.
        assert!(!digest_catchup_due(7, 8, 100, None, None, true));
        // Вышли из окна +6 ч: вечером «утренний» список не шлём.
        assert!(!digest_catchup_due(14, 8, 100, None, None, true));
        // Будильник стоял на ДРУГОЙ день — сегодня догоняем.
        assert!(digest_catchup_due(9, 8, 100, Some(101), None, true));
        // Полночный час: окно не переполняется за сутки.
        assert!(digest_catchup_due(3, 0, 100, None, None, true));
        assert!(!digest_catchup_due(6, 0, 100, None, None, true));
    }

    /// Решение по аларму дайджеста: без аларма — ставим; с тем же контентом —
    /// не трогаем; контент дня изменился (задачи добавили вечером) или
    /// сменился день — переставляем; пустой день — снимаем.
    #[test]
    fn digest_action_reschedules_on_content_change() {
        let target = (20_000i64, 111u64);
        assert_eq!(
            digest_action(false, None, target, true),
            DigestAction::Schedule
        );
        assert_eq!(
            digest_action(true, Some(target), target, true),
            DigestAction::Keep
        );
        assert_eq!(
            digest_action(true, Some((20_000, 222)), target, true),
            DigestAction::Schedule
        );
        assert_eq!(
            digest_action(true, Some((19_999, 111)), target, true),
            DigestAction::Schedule
        );
        assert_eq!(
            digest_action(true, None, target, true),
            DigestAction::Schedule
        );
        assert_eq!(
            digest_action(true, Some(target), target, false),
            DigestAction::Cancel
        );
        assert_eq!(
            digest_action(false, None, target, false),
            DigestAction::Cancel
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

    /// Общее «Напоминание» в ту же минуту, что «Пора выезжать»/«Пора
    /// собираться», не создаётся (два уведомления в одну минуту на одну
    /// задачу воспринимались как дубль). Другие минуты остаются.
    #[test]
    fn remind_at_travel_minute_is_deduped() {
        let p = prefs(true, true, vec![60]);
        let day = NaiveDate::from_ymd_opt(2026, 8, 16).unwrap();
        let date_epoch = crate::commands::date_to_epoch(day);
        // Выезд за 60 мин = момент общего напоминания «за 1 час» (10:00 - 60).
        let evs = task_events(
            &p,
            &(
                "t1".into(),
                "Задача".into(),
                Some(600),
                date_epoch,
                Some(60),
                None,
                None,
            ),
        );
        let kinds: Vec<&str> = evs.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["travel"]);
        assert_eq!(evs[0].due, day.and_hms_opt(9, 0, 0).unwrap());
        // Другой интервал (90 мин = 08:30) — и напоминание, и выезд остаются.
        let p90 = prefs(true, true, vec![90]);
        let evs2 = task_events(
            &p90,
            &(
                "t1".into(),
                "Задача".into(),
                Some(600),
                date_epoch,
                Some(60),
                None,
                None,
            ),
        );
        let mut kinds2: Vec<&str> = evs2.iter().map(|e| e.kind).collect();
        kinds2.sort_unstable();
        assert_eq!(kinds2, ["remind", "travel"]);
        // «Пора собираться» тоже перекрывает напоминание в свою минуту:
        // выезд за 60, сборы за 15 до выезда = за 75 мин до начала → 08:45;
        // глобальный интервал 75 мин даёт ровно ту же минуту.
        let p75 = prefs(true, true, vec![75]);
        let evs3 = task_events(
            &p75,
            &(
                "t1".into(),
                "Задача".into(),
                Some(600),
                date_epoch,
                Some(60),
                None,
                Some(15),
            ),
        );
        let mut kinds3: Vec<&str> = evs3.iter().map(|e| e.kind).collect();
        kinds3.sort_unstable();
        assert_eq!(kinds3, ["travel", "travel_prepare"]);
    }

    /// Своё notify_minutes перекрывает глобальные интервалы.
    #[test]
    fn task_intervals_own_override() {
        let p = prefs(true, true, vec![15, 60]);
        assert_eq!(task_intervals(Some(1440), &p), vec![1440]);
        assert_eq!(task_intervals(None, &p), vec![15, 60]);
        // 0 и отрицательные — «не напоминать» (раньше отрицательное значение
        // молча уходило в общие интервалы, а 0 зависел от фильтра вызывающего).
        assert!(task_intervals(Some(0), &p).is_empty());
        assert!(task_intervals(Some(-30), &p).is_empty());
    }

    /// Настройки из битого/рукоправленного файла приводятся к диапазонам: час
    /// вне 0..23 через `as u32` отключал дайджест навсегда, неположительный
    /// интервал стрелял после начала задачи.
    #[test]
    fn prefs_are_sanitized() {
        let mut p = NotifyPrefs {
            day_summary_hour: -5,
            remind_minutes: vec![0, -30, 60],
            ..NotifyPrefs::default()
        };
        sanitize_prefs(&mut p);
        assert_eq!(p.day_summary_hour, 0);
        assert_eq!(p.remind_minutes, vec![60]);

        let mut p2 = NotifyPrefs {
            day_summary_hour: 99,
            ..NotifyPrefs::default()
        };
        sanitize_prefs(&mut p2);
        assert_eq!(p2.day_summary_hour, 23);
    }
}
