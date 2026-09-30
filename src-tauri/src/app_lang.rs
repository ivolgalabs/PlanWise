//! Язык нативных уведомлений (мост «фронтенд → Rust»).
//!
//! Выбранный в UI язык живёт в localStorage вебвью (`planwise_lang`), поэтому
//! планировщик уведомлений о нём не знает. Фронтенд при старте и при каждой
//! смене языка вызывает команду `set_app_lang`, а Rust строит тексты
//! уведомлений на этом языке.
//!
//! Тексты собраны таблицей `Texts` — по одному шаблону на язык; значения
//! (заголовок задачи, время, интервал, счётчик) подставляются в шаблон через
//! `fill`. Шаблоны статичны, поэтому `format!` (которому нужен строковый
//! литерал) здесь не используется. Русский набор обязан совпадать с прежними
//! строками байт-в-байт — это держит тест ниже.
//!
//! Неизвестный/пустой код языка → русский: до появления моста уведомления
//! были русскими, и при отсутствии команды поведение не меняется.

use std::sync::Mutex;

/// Текущий язык уведомлений. Пусто = не задан → [`DEFAULT_LANG`].
/// `Mutex::new` и `String::new` — const, поэтому статик без ленивой инициализации.
static APP_LANG: Mutex<String> = Mutex::new(String::new());

const DEFAULT_LANG: &str = "ru";

/// Текущий язык (для сборки текстов). Пустое значение читается как русский.
pub fn current() -> String {
    let guard = APP_LANG.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_empty() {
        DEFAULT_LANG.to_string()
    } else {
        guard.clone()
    }
}

/// Запомнить язык уведомлений.
pub fn set(lang: String) {
    let mut guard = APP_LANG.lock().unwrap_or_else(|e| e.into_inner());
    *guard = lang;
}

/// Команда моста: применить выбранный в UI язык к текстам нативных уведомлений.
#[tauri::command]
pub fn set_app_lang(lang: String) {
    set(lang);
}

/// Шаблоны одного языка. `{title}`/`{time}`/`{extra}`/`{interval}`/`{n}`/`{p}`/
/// `{d}`/`{h}`/`{m}` — подстановки `fill`.
struct Texts {
    more_tasks: &'static str,
    travel_title: &'static str,
    travel_body: &'static str,
    prepare_title: &'static str,
    prev_day: &'static str,
    prepare_body: &'static str,
    remind_title: &'static str,
    remind_body: &'static str,
    channel_name: &'static str,
    channel_desc: &'static str,
    /// Интервалы напоминания (формат_interval): дни/часы/минуты.
    iv_day: &'static str,
    iv_day_min: &'static str,
    iv_day_hour: &'static str,
    iv_day_hour_min: &'static str,
    iv_hour: &'static str,
    iv_hour_min: &'static str,
    iv_min: &'static str,
    /// Заголовок дайджеста на десктопе: «Задачи на сегодня (N)».
    digest_title: &'static str,
    /// Заголовок дайджеста на Android: «План на сегодня: 5 задач».
    plan_title: &'static str,
    all_day: &'static str,
    timed_summary: &'static str,
    /// Формы «задача/задачи/задач» с числом.
    task_one: &'static str,
    task_few: &'static str,
    task_many: &'static str,
}

const RU: Texts = Texts {
    more_tasks: "\n… и ещё {n} задач",
    travel_title: "Пора выезжать",
    travel_body: "«{title}» — в {time}",
    prepare_title: "Пора собираться",
    prev_day: " (накануне)",
    prepare_body: "«{title}» — выезд в {time}{extra}",
    remind_title: "Напоминание",
    remind_body: "«{title}» — {interval}",
    channel_name: "Напоминания и задачи",
    channel_desc: "Напоминания о задачах и утренний список дел",
    iv_day: "за {d} дн",
    iv_day_min: "за {d} дн {m} мин",
    iv_day_hour: "за {d} дн {h} ч",
    iv_day_hour_min: "за {d} дн {h} ч {m} мин",
    iv_hour: "за {h} ч",
    iv_hour_min: "за {h} ч {m} мин",
    iv_min: "за {m} мин",
    digest_title: "Задачи на сегодня ({n})",
    plan_title: "План на сегодня: {p}",
    all_day: "в течение дня",
    timed_summary: "{p} со временем",
    task_one: "{n} задача",
    task_few: "{n} задачи",
    task_many: "{n} задач",
};

const EN: Texts = Texts {
    more_tasks: "\n… and {n} more tasks",
    travel_title: "Time to leave",
    travel_body: "«{title}» — at {time}",
    prepare_title: "Time to get ready",
    prev_day: " (the day before)",
    prepare_body: "«{title}» — leave at {time}{extra}",
    remind_title: "Reminder",
    remind_body: "«{title}» — {interval}",
    channel_name: "Reminders and tasks",
    channel_desc: "Task reminders and the morning to-do list",
    iv_day: "in {d} d",
    iv_day_min: "in {d} d {m} min",
    iv_day_hour: "in {d} d {h} h",
    iv_day_hour_min: "in {d} d {h} h {m} min",
    iv_hour: "in {h} h",
    iv_hour_min: "in {h} h {m} min",
    iv_min: "in {m} min",
    digest_title: "Today's tasks ({n})",
    plan_title: "Today's plan: {p}",
    all_day: "throughout the day",
    timed_summary: "{p} timed",
    task_one: "{n} task",
    task_few: "{n} tasks",
    task_many: "{n} tasks",
};

const ES: Texts = Texts {
    more_tasks: "\n… y {n} tareas más",
    travel_title: "Hora de salir",
    travel_body: "«{title}» — a las {time}",
    prepare_title: "Hora de prepararse",
    prev_day: " (la víspera)",
    prepare_body: "«{title}» — salida a las {time}{extra}",
    remind_title: "Recordatorio",
    remind_body: "«{title}» — {interval}",
    channel_name: "Recordatorios y tareas",
    channel_desc: "Recordatorios de tareas y la lista de la mañana",
    iv_day: "en {d} d",
    iv_day_min: "en {d} d {m} min",
    iv_day_hour: "en {d} d {h} h",
    iv_day_hour_min: "en {d} d {h} h {m} min",
    iv_hour: "en {h} h",
    iv_hour_min: "en {h} h {m} min",
    iv_min: "en {m} min",
    digest_title: "Tareas de hoy ({n})",
    plan_title: "Plan de hoy: {p}",
    all_day: "durante el día",
    timed_summary: "{p} con hora",
    task_one: "{n} tarea",
    task_few: "{n} tareas",
    task_many: "{n} tareas",
};

const DE: Texts = Texts {
    more_tasks: "\n… und {n} weitere Aufgaben",
    travel_title: "Zeit zum Losfahren",
    travel_body: "«{title}» — um {time}",
    prepare_title: "Zeit, sich fertigzumachen",
    prev_day: " (am Vortag)",
    prepare_body: "«{title}» — Abfahrt um {time}{extra}",
    remind_title: "Erinnerung",
    remind_body: "«{title}» — {interval}",
    channel_name: "Erinnerungen und Aufgaben",
    channel_desc: "Aufgabenerinnerungen und die Morgenliste",
    iv_day: "in {d} Tg",
    iv_day_min: "in {d} Tg {m} Min",
    iv_day_hour: "in {d} Tg {h} Std",
    iv_day_hour_min: "in {d} Tg {h} Std {m} Min",
    iv_hour: "in {h} Std",
    iv_hour_min: "in {h} Std {m} Min",
    iv_min: "in {m} Min",
    digest_title: "Aufgaben für heute ({n})",
    plan_title: "Plan für heute: {p}",
    all_day: "im Laufe des Tages",
    timed_summary: "{p} mit Uhrzeit",
    task_one: "{n} Aufgabe",
    task_few: "{n} Aufgaben",
    task_many: "{n} Aufgaben",
};

const FR: Texts = Texts {
    more_tasks: "\n… et {n} tâches de plus",
    travel_title: "Il est temps de partir",
    travel_body: "«{title}» — à {time}",
    prepare_title: "Il est temps de se préparer",
    prev_day: " (la veille)",
    prepare_body: "«{title}» — départ à {time}{extra}",
    remind_title: "Rappel",
    remind_body: "«{title}» — {interval}",
    channel_name: "Rappels et tâches",
    channel_desc: "Rappels de tâches et liste du matin",
    iv_day: "dans {d} j",
    iv_day_min: "dans {d} j {m} min",
    iv_day_hour: "dans {d} j {h} h",
    iv_day_hour_min: "dans {d} j {h} h {m} min",
    iv_hour: "dans {h} h",
    iv_hour_min: "dans {h} h {m} min",
    iv_min: "dans {m} min",
    digest_title: "Tâches du jour ({n})",
    plan_title: "Plan du jour : {p}",
    all_day: "au cours de la journée",
    timed_summary: "{p} avec une heure",
    task_one: "{n} tâche",
    task_few: "{n} tâches",
    task_many: "{n} tâches",
};

const PT: Texts = Texts {
    more_tasks: "\n… e mais {n} tarefas",
    travel_title: "Hora de sair",
    travel_body: "«{title}» — às {time}",
    prepare_title: "Hora de se preparar",
    prev_day: " (na véspera)",
    prepare_body: "«{title}» — saída às {time}{extra}",
    remind_title: "Lembrete",
    remind_body: "«{title}» — {interval}",
    channel_name: "Lembretes e tarefas",
    channel_desc: "Lembretes de tarefas e a lista da manhã",
    iv_day: "em {d} d",
    iv_day_min: "em {d} d {m} min",
    iv_day_hour: "em {d} d {h} h",
    iv_day_hour_min: "em {d} d {h} h {m} min",
    iv_hour: "em {h} h",
    iv_hour_min: "em {h} h {m} min",
    iv_min: "em {m} min",
    digest_title: "Tarefas de hoje ({n})",
    plan_title: "Plano de hoje: {p}",
    all_day: "ao longo do dia",
    timed_summary: "{p} com horário",
    task_one: "{n} tarefa",
    task_few: "{n} tarefas",
    task_many: "{n} tarefas",
};

const ZH: Texts = Texts {
    more_tasks: "\n… 还有 {n} 项任务",
    travel_title: "该出发了",
    travel_body: "«{title}» — {time} 出发",
    prepare_title: "该准备了",
    prev_day: "（前一天）",
    prepare_body: "«{title}» — {time} 出发{extra}",
    remind_title: "提醒",
    remind_body: "«{title}» — {interval}",
    channel_name: "提醒和任务",
    channel_desc: "任务提醒和早晨待办清单",
    iv_day: "{d} 天后",
    iv_day_min: "{d} 天 {m} 分钟后",
    iv_day_hour: "{d} 天 {h} 小时后",
    iv_day_hour_min: "{d} 天 {h} 小时 {m} 分钟后",
    iv_hour: "{h} 小时后",
    iv_hour_min: "{h} 小时 {m} 分钟后",
    iv_min: "{m} 分钟后",
    digest_title: "今日任务（{n}）",
    plan_title: "今日计划：{p}",
    all_day: "全天",
    timed_summary: "{p} 有时间",
    task_one: "{n} 个任务",
    task_few: "{n} 个任务",
    task_many: "{n} 个任务",
};

const JA: Texts = Texts {
    more_tasks: "\n… 他に {n} 件",
    travel_title: "そろそろ出発です",
    travel_body: "«{title}» — {time} に出発",
    prepare_title: "そろそろ支度を",
    prev_day: "（前日）",
    prepare_body: "«{title}» — {time} に出発{extra}",
    remind_title: "リマインダー",
    remind_body: "«{title}» — {interval}",
    channel_name: "リマインダーとタスク",
    channel_desc: "タスクのリマインダーと朝のやることリスト",
    iv_day: "{d} 日後",
    iv_day_min: "{d} 日 {m} 分後",
    iv_day_hour: "{d} 日 {h} 時間後",
    iv_day_hour_min: "{d} 日 {h} 時間 {m} 分後",
    iv_hour: "{h} 時間後",
    iv_hour_min: "{h} 時間 {m} 分後",
    iv_min: "{m} 分後",
    digest_title: "今日のタスク（{n}）",
    plan_title: "今日の予定：{p}",
    all_day: "一日中",
    timed_summary: "{p} に時刻あり",
    task_one: "{n} 件のタスク",
    task_few: "{n} 件のタスク",
    task_many: "{n} 件のタスク",
};

const KO: Texts = Texts {
    more_tasks: "\n… 외 {n}개 작업",
    travel_title: "출발할 시간이에요",
    travel_body: "«{title}» — {time} 출발",
    prepare_title: "준비할 시간이에요",
    prev_day: " (전날)",
    prepare_body: "«{title}» — {time} 출발{extra}",
    remind_title: "알림",
    remind_body: "«{title}» — {interval}",
    channel_name: "알림 및 작업",
    channel_desc: "작업 알림과 아침 할 일 목록",
    iv_day: "{d}일 후",
    iv_day_min: "{d}일 {m}분 후",
    iv_day_hour: "{d}일 {h}시간 후",
    iv_day_hour_min: "{d}일 {h}시간 {m}분 후",
    iv_hour: "{h}시간 후",
    iv_hour_min: "{h}시간 {m}분 후",
    iv_min: "{m}분 후",
    digest_title: "오늘의 작업 ({n})",
    plan_title: "오늘 계획: {p}",
    all_day: "하루 종일",
    timed_summary: "{p} 시간 지정",
    task_one: "{n}개 작업",
    task_few: "{n}개 작업",
    task_many: "{n}개 작업",
};

/// Таблица текстов для текущего языка; неизвестный код — русский.
fn texts() -> &'static Texts {
    match current().as_str() {
        "en" => &EN,
        "es" => &ES,
        "de" => &DE,
        "fr" => &FR,
        "pt" => &PT,
        "zh" => &ZH,
        "ja" => &JA,
        "ko" => &KO,
        _ => &RU,
    }
}

/// Подстановка значений в шаблон по ключам вида `{name}`. Шаблоны статичны,
/// значения — числа, время и заголовок задачи.
fn fill(tpl: &str, pairs: &[(&str, String)]) -> String {
    let mut out = tpl.to_string();
    for (key, value) in pairs {
        if out.contains(key) {
            out = out.replace(key, value);
        }
    }
    out
}

/// «… и ещё N задач» — хвост тела утреннего дайджеста (десктоп).
pub fn more_tasks(n: usize) -> String {
    fill(texts().more_tasks, &[("{n}", n.to_string())])
}

/// «Пора выезжать».
pub fn travel_title() -> &'static str {
    texts().travel_title
}

/// Тело «выезжать»: «{title}» — в HH:MM.
pub fn travel_body(title: &str, time: &str) -> String {
    fill(
        texts().travel_body,
        &[("{title}", title.to_string()), ("{time}", time.to_string())],
    )
}

/// «Пора собираться».
pub fn prepare_title() -> &'static str {
    texts().prepare_title
}

/// Пометка «накануне» (выезд после полуночи).
pub fn prev_day() -> &'static str {
    texts().prev_day
}

/// Тело «собираться»: «{title}» — выезд в HH:MM{extra}.
pub fn prepare_body(title: &str, time: &str, extra: &str) -> String {
    fill(
        texts().prepare_body,
        &[
            ("{title}", title.to_string()),
            ("{time}", time.to_string()),
            ("{extra}", extra.to_string()),
        ],
    )
}

/// «Напоминание».
pub fn remind_title() -> &'static str {
    texts().remind_title
}

/// Тело напоминания: «{title}» — {локальный интервал}.
pub fn remind_body(title: &str, interval: &str) -> String {
    fill(
        texts().remind_body,
        &[
            ("{title}", title.to_string()),
            ("{interval}", interval.to_string()),
        ],
    )
}

/// Название канала уведомлений Android.
pub fn channel_name() -> &'static str {
    texts().channel_name
}

/// Описание канала уведомлений Android.
pub fn channel_desc() -> &'static str {
    texts().channel_desc
}

/// «За сколько» для тела напоминания. Разбор на дни/часы/минуты не зависит от
/// языка — меняется только шаблон (предлог/единицы), поэтому ветвление одно.
pub fn format_interval(rm: i64) -> String {
    let t = texts();
    if rm >= 1440 {
        let (d, h, m) = (rm / 1440, (rm % 1440) / 60, rm % 60);
        match (h, m) {
            (0, 0) => fill(t.iv_day, &[("{d}", d.to_string())]),
            (0, m) => fill(
                t.iv_day_min,
                &[("{d}", d.to_string()), ("{m}", m.to_string())],
            ),
            (h, 0) => fill(
                t.iv_day_hour,
                &[("{d}", d.to_string()), ("{h}", h.to_string())],
            ),
            (h, m) => fill(
                t.iv_day_hour_min,
                &[
                    ("{d}", d.to_string()),
                    ("{h}", h.to_string()),
                    ("{m}", m.to_string()),
                ],
            ),
        }
    } else if rm >= 60 {
        let (h, m) = (rm / 60, rm % 60);
        if m == 0 {
            fill(t.iv_hour, &[("{h}", h.to_string())])
        } else {
            fill(
                t.iv_hour_min,
                &[("{h}", h.to_string()), ("{m}", m.to_string())],
            )
        }
    } else {
        fill(t.iv_min, &[("{m}", rm.to_string())])
    }
}

/// Заголовок утреннего дайджеста на десктопе: «Задачи на сегодня (N)».
pub fn digest_title(n: usize) -> String {
    fill(texts().digest_title, &[("{n}", n.to_string())])
}

/// Русские правила множественного числа: 1 задача, 2 задачи, 5 задач.
fn ru_plural_index(n: usize) -> usize {
    let n10 = n % 10;
    let n100 = n % 100;
    if n10 == 1 && n100 != 11 {
        0
    } else if (2..=4).contains(&n10) && !(12..=14).contains(&n100) {
        1
    } else {
        2
    }
}

/// «1 задача», «2 задачи», «5 задач» — форма числа для дайджеста Android.
pub fn plural_tasks(n: usize) -> String {
    let t = texts();
    let idx = match current().as_str() {
        "en" | "es" | "de" | "fr" | "pt" => {
            if n == 1 {
                0
            } else {
                1
            }
        }
        "zh" | "ja" | "ko" => 0,
        _ => ru_plural_index(n),
    };
    let forms = [t.task_one, t.task_few, t.task_many];
    fill(forms[idx], &[("{n}", n.to_string())])
}

/// Заголовок дайджеста Android: «План на сегодня: 5 задач».
pub fn plan_title(n: usize) -> String {
    fill(texts().plan_title, &[("{p}", plural_tasks(n))])
}

/// Сводка пустого по времени дня: «в течение дня».
pub fn all_day() -> &'static str {
    texts().all_day
}

/// Сводка дня со временем: «3 задачи со временем».
pub fn timed_summary(n: usize) -> String {
    fill(texts().timed_summary, &[("{p}", plural_tasks(n))])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    /// Язык — глобальный статик, а тесты идут параллельно: смена языка в одном
    /// тесте иначе видна другому. Отдельный (не APP_LANG) замок: внутри функций
    /// APP_LANG лочится сам, реентерабельно взять его нельзя.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn guard() -> MutexGuard<'static, ()> {
        TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Русский набор обязан совпадать с прежними строками байт-в-байт: иначе
    /// переводить язык, которого пользователь не выбирал, значит ломать уже
    /// привычный текст. Тест держит и интервалы (все семь ветвей), и счётчики.
    #[test]
    fn russian_texts_are_byte_identical() {
        let _g = guard();
        set(String::new());
        assert_eq!(more_tasks(3), "\n… и ещё 3 задач");
        assert_eq!(travel_title(), "Пора выезжать");
        assert_eq!(travel_body("Задача", "09:30"), "«Задача» — в 09:30");
        assert_eq!(prepare_title(), "Пора собираться");
        assert_eq!(prev_day(), " (накануне)");
        assert_eq!(
            prepare_body("Задача", "08:45", prev_day()),
            "«Задача» — выезд в 08:45 (накануне)"
        );
        assert_eq!(
            prepare_body("Задача", "08:45", ""),
            "«Задача» — выезд в 08:45"
        );
        assert_eq!(remind_title(), "Напоминание");
        assert_eq!(
            remind_body("Задача", &format_interval(60)),
            "«Задача» — за 1 ч"
        );
        assert_eq!(channel_name(), "Напоминания и задачи");
        assert_eq!(
            channel_desc(),
            "Напоминания о задачах и утренний список дел"
        );
        assert_eq!(digest_title(5), "Задачи на сегодня (5)");
        assert_eq!(plan_title(5), "План на сегодня: 5 задач");
        assert_eq!(plan_title(1), "План на сегодня: 1 задача");
        assert_eq!(plan_title(22), "План на сегодня: 22 задачи");
        assert_eq!(all_day(), "в течение дня");
        assert_eq!(timed_summary(3), "3 задачи со временем");
        assert_eq!(plural_tasks(1), "1 задача");
        assert_eq!(plural_tasks(2), "2 задачи");
        assert_eq!(plural_tasks(5), "5 задач");
        assert_eq!(plural_tasks(11), "11 задач");
        assert_eq!(plural_tasks(21), "21 задача");
        // Все ветви format_interval (как в прежнем хардкоде).
        assert_eq!(format_interval(15), "за 15 мин");
        assert_eq!(format_interval(60), "за 1 ч");
        assert_eq!(format_interval(90), "за 1 ч 30 мин");
        assert_eq!(format_interval(1440), "за 1 дн");
        assert_eq!(format_interval(1440 + 30), "за 1 дн 30 мин");
        assert_eq!(format_interval(1440 * 2 + 60), "за 2 дн 1 ч");
        assert_eq!(format_interval(1440 * 2 + 60 + 30), "за 2 дн 1 ч 30 мин");
    }

    /// Выбор языка переключает шаблоны и формы числа; неизвестный код —
    /// русский фолбэк (фронтенд присылает только коды из i18n.ts).
    #[test]
    fn language_switch_uses_translations() {
        let _g = guard();
        set("en".into());
        assert_eq!(travel_title(), "Time to leave");
        assert_eq!(format_interval(90), "in 1 h 30 min");
        assert_eq!(plural_tasks(3), "3 tasks");
        assert_eq!(plan_title(1), "Today's plan: 1 task");
        set("zh".into());
        assert_eq!(plural_tasks(7), "7 个任务");
        set("xx".into());
        assert_eq!(travel_title(), "Пора выезжать");
        set(String::new());
    }
}
