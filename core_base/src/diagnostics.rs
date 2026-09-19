//! Диагностика падений: кольцевой буфер последних сообщений + обработчик паники.
//!
//! Зачем: приложение падает молча — в релизе (без терминала) от паники не остаётся
//! ничего, кроме исчезнувшего окна. Модуль запоминает последние действия (то, что
//! приложение успело записать через [`record`]) и при панике сохраняет отчёт с
//! текстом паники, местом, backtrace и хвостом журнала в файл рядом с данными
//! приложения. Отчёт можно выгрузить и вручную — [`export`].
//!
//! Зависимостей нет: backtrace берётся из `std::backtrace`, время форматируется
//! собственным календарным преобразованием (без `chrono`).
//!
//! Типовое подключение — один раз при старте, когда известен каталог данных:
//!
//! ```no_run
//! # fn main() -> std::io::Result<()> {
//! core_base::diagnostics::init("InvestLens", env!("CARGO_PKG_VERSION"), "/tmp/logs")?;
//! core_base::diagnostics::record("открыта БД портфеля");
//! # Ok(())
//! # }
//! ```

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Сколько последних строк держим в памяти. Кольцо намеренно короткое: в отчёт
/// попадает контекст последних действий, а не весь журнал за сессию.
const CAPACITY: usize = 500;

/// Сколько файлов отчётов храним на диске (старые удаляются).
const KEEP_REPORTS: usize = 10;

/// Сборщик отчётов. Глобальный экземпляр — под [`init`]; в тестах создаётся свой,
/// чтобы не зависеть от порядка выполнения.
struct Reporter {
    app: String,
    version: String,
    dir: PathBuf,
    lines: VecDeque<String>,
}

impl Reporter {
    fn new(app: &str, version: &str, dir: impl Into<PathBuf>) -> std::io::Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        Ok(Self {
            app: app.to_string(),
            version: version.to_string(),
            dir,
            lines: VecDeque::with_capacity(CAPACITY),
        })
    }

    fn record(&mut self, message: &str) {
        if self.lines.len() == CAPACITY {
            self.lines.pop_front();
        }
        self.lines
            .push_back(format!("{} {}", iso8601(SystemTime::now()), message));
    }

    fn snapshot(&self) -> Vec<String> {
        self.lines.iter().cloned().collect()
    }

    fn header(&self) -> String {
        format!(
            "{} {} — отчёт от {} ({}/{})",
            self.app,
            self.version,
            iso8601(SystemTime::now()),
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    }

    /// Текст отчёта о панике: шапка, паника, место, backtrace, хвост журнала.
    fn crash_body(&self, message: &str, location: &str) -> String {
        format!(
            "{}\n--- паника ---\n{}\nместо: {}\n--- backtrace ---\n{}\n--- последние действия ---\n{}\n",
            self.header(),
            message,
            location,
            std::backtrace::Backtrace::force_capture(),
            self.snapshot().join("\n")
        )
    }

    /// Ручная выгрузка (кнопка «сохранить диагностику» в интерфейсе).
    fn export_body(&self) -> String {
        format!(
            "{}\n--- последние действия ---\n{}\n",
            self.header(),
            self.snapshot().join("\n")
        )
    }

    fn write(&self, prefix: &str, body: &str) -> std::io::Result<PathBuf> {
        let path = self
            .dir
            .join(format!("{prefix}-{}.log", compact_stamp(SystemTime::now())));
        fs::write(&path, body)?;
        prune(&self.dir);
        Ok(path)
    }
}

/// Глобальный сборщик: обработчик паники держит `Arc` на тот же экземпляр, что и
/// публичные функции, поэтому не зависит от порядка инициализации.
static STATE: OnceLock<Arc<Mutex<Reporter>>> = OnceLock::new();

/// Инициализировать диагностику: создать каталог отчётов и повесить обработчик
/// паники. Вызывать один раз при старте; повторный вызов ничего не меняет.
pub fn init(app: &str, version: &str, crash_dir: impl Into<PathBuf>) -> std::io::Result<()> {
    let reporter = Arc::new(Mutex::new(Reporter::new(app, version, crash_dir)?));
    if STATE.set(Arc::clone(&reporter)).is_err() {
        return Ok(());
    }

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Обработчик обязан быть безопасным на панике: без unwrap и без паник внутри.
        let (message, location) = panic_details(info);
        let saved = {
            let reporter = lock(&reporter);
            let body = reporter.crash_body(&message, &location);
            reporter.write("crash", &body)
        };
        match saved {
            Ok(path) => eprintln!("[diagnostics] отчёт о сбое сохранён: {}", path.display()),
            Err(e) => eprintln!("[diagnostics] не удалось сохранить отчёт о сбое: {e}"),
        }
        previous(info);
    }));

    Ok(())
}

/// Запомнить строку журнала (попадёт в отчёт при панике). Дешёвая операция:
/// блокировка на время push, без ввода-вывода в файл.
pub fn record(message: impl AsRef<str>) {
    if let Some(state) = STATE.get() {
        lock(state).record(message.as_ref());
    }
}

/// Снимок кольцевого буфера (последние действия, старые — в начале).
pub fn snapshot() -> Vec<String> {
    STATE.get().map(|s| lock(s).snapshot()).unwrap_or_default()
}

/// Каталог отчётов, если диагностика инициализирована.
pub fn crash_dir() -> Option<PathBuf> {
    STATE.get().map(|s| lock(s).dir.clone())
}

/// Сохранить отчёт вручную; возвращает путь к файлу.
pub fn export() -> std::io::Result<PathBuf> {
    match STATE.get() {
        Some(state) => {
            let reporter = lock(state);
            reporter.write("diagnostics", &reporter.export_body())
        }
        None => Err(std::io::Error::new(
            std::io::ErrorKind::NotConnected,
            "диагностика не инициализирована",
        )),
    }
}

/// Путь к самому свежему отчёту о сбое — чтобы интерфейс мог предложить
/// «отправить отчёт о прошлом запуске».
pub fn last_crash(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(is_crash_name)
        })
        .max()
}

fn is_crash_name(name: &str) -> bool {
    name.starts_with("crash-") && name.ends_with(".log")
}

/// Оставить последние [`KEEP_REPORTS`] файлов, остальные удалить: диагностика не
/// должна превращаться в источник роста диска.
fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                (is_crash_name(n) || n.starts_with("diagnostics-")) && n.ends_with(".log")
            })
        })
        .collect();
    if files.len() <= KEEP_REPORTS {
        return;
    }
    // Имена начинаются с метки времени — лексикографический порядок совпадает с хронологическим.
    files.sort();
    let excess = files.len() - KEEP_REPORTS;
    for path in files.into_iter().take(excess) {
        let _ = fs::remove_file(path);
    }
}

fn panic_details(info: &std::panic::PanicHookInfo<'_>) -> (String, String) {
    let payload = info.payload();
    let message = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "неизвестный тип паники".to_string()
    };
    let location = match info.location() {
        Some(loc) => format!("{}:{}:{}", loc.file(), loc.line(), loc.column()),
        None => "неизвестно".to_string(),
    };
    (message, location)
}

/// Мьютекс переживает панику одного из потоков: отчёт нужен как раз после неё.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// UTC-время в формате ISO 8601 (`2026-09-15T10:22:31Z`).
pub fn iso8601(t: SystemTime) -> String {
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Метка времени для имени файла: `20260915-102231-456` (миллисекунды — чтобы
/// два отчёта подряд не перезаписывали друг друга).
fn compact_stamp(t: SystemTime) -> String {
    let millis = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_millis())
        .unwrap_or(0);
    format!(
        "{}-{millis:03}",
        iso8601(t)
            .replace(['-', ':'], "")
            .replace('T', "-")
            .replace('Z', "")
    )
}

/// Дни с 1970-01-01 → (год, месяц, день). Алгоритм Говарда Хиннанта
/// (`civil_from_days`), чтобы не тянуть `chrono` ради одной даты.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cb-diag-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn iso8601_formats_epoch_and_known_dates() {
        assert_eq!(iso8601(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        // Константы сверены с системным `date -u`: 1_789_467_751 = 2026-09-15T10:22:31Z.
        let t = UNIX_EPOCH + Duration::from_secs(1_789_467_751);
        assert_eq!(iso8601(t), "2026-09-15T10:22:31Z");
        let leap = UNIX_EPOCH + Duration::from_secs(1_709_164_800);
        assert_eq!(iso8601(leap), "2024-02-29T00:00:00Z");
    }

    #[test]
    fn civil_from_days_covers_leap_years_and_century_rule() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(59), (1970, 3, 1));
        // 2000 — високосный (делится на 400), 1900 — нет.
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(-25_567), (1900, 1, 1));
    }

    #[test]
    fn ring_buffer_keeps_last_lines_only() {
        let mut reporter = Reporter::new("cap", "0.0.1", temp_dir("cap")).expect("reporter");
        for i in 0..(CAPACITY + 50) {
            reporter.record(&format!("строка {i}"));
        }
        let lines = reporter.snapshot();
        assert_eq!(lines.len(), CAPACITY);
        assert!(
            lines[0].ends_with("строка 50"),
            "первая строка: {}",
            lines[0]
        );
        assert!(lines[CAPACITY - 1].ends_with(&format!("строка {}", CAPACITY + 49)));
        let _ = fs::remove_dir_all(&reporter.dir);
    }

    #[test]
    fn export_writes_report_with_context() {
        let dir = temp_dir("export");
        let mut reporter = Reporter::new("test-export", "9.9.9", &dir).expect("reporter");
        reporter.record("нажата кнопка «Экспорт»");
        let path = reporter
            .write("diagnostics", &reporter.export_body())
            .expect("write report");
        let body = fs::read_to_string(&path).expect("read report");
        assert!(body.contains("test-export 9.9.9"), "шапка: {body}");
        assert!(body.contains("нажата кнопка «Экспорт»"), "журнал: {body}");
        assert_eq!(last_crash(&dir), None, "ручная выгрузка — не crash-отчёт");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn crash_body_contains_message_location_and_log_tail() {
        let mut reporter =
            Reporter::new("test-crash", "1.2.3", temp_dir("crash")).expect("reporter");
        reporter.record("открыт файл report.pdf");
        let body = reporter.crash_body("index out of bounds", "src/db.rs:41:9");
        assert!(body.contains("test-crash 1.2.3"), "шапка: {body}");
        assert!(body.contains("index out of bounds"), "паника: {body}");
        assert!(body.contains("src/db.rs:41:9"), "место: {body}");
        assert!(
            body.contains("открыт файл report.pdf"),
            "хвост журнала: {body}"
        );
        assert!(body.contains("--- backtrace ---"), "backtrace: {body}");
        let _ = fs::remove_dir_all(&reporter.dir);
    }

    #[test]
    fn prune_keeps_only_recent_reports() {
        let dir = temp_dir("prune");
        let reporter = Reporter::new("test-prune", "0.0.1", &dir).expect("reporter");
        for i in 0..(KEEP_REPORTS + 5) {
            reporter
                .write("crash", &format!("отчёт {i}"))
                .expect("write report");
            std::thread::sleep(Duration::from_millis(8));
        }
        let files = fs::read_dir(&dir).expect("read dir").count();
        assert_eq!(files, KEEP_REPORTS, "осталось файлов: {files}");
        // Остались самые свежие, старые удалены.
        let newest = fs::read_to_string(
            reporter.dir.join(
                fs::read_dir(&dir)
                    .expect("dir")
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .max()
                    .expect("хотя бы один файл"),
            ),
        )
        .expect("read newest");
        assert!(newest.contains("отчёт 14"), "самый свежий: {newest}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Сквозная проверка обработчика паники: паника внутри `catch_unwind` пишет файл
    /// в каталог, переданный в `init`. Глобальное состояние трогает только этот тест.
    #[test]
    fn panic_hook_writes_crash_file() {
        let dir = temp_dir("hook");
        init("test-hook", "0.0.2", &dir).expect("init");
        record("действие перед падением");
        let _ = std::panic::catch_unwind(|| panic!("тестовое падение"));
        let path = last_crash(&dir).expect("отчёт о сбое не создан");
        let body = fs::read_to_string(path).expect("read crash");
        assert!(body.contains("тестовое падение"), "текст паники: {body}");
        assert!(body.contains("действие перед падением"), "журнал: {body}");
        let _ = fs::remove_dir_all(&dir);
    }
}
