//! Проверка диагностики на живом процессе (а не только в тесте):
//!
//! ```bash
//! cargo run --example crash_report   # код возврата 101, отчёт — в каталоге ниже
//! ```
//!
//! Печатает путь к отчёту, пишет пару записей в кольцо журнала и падает намеренно.

fn main() {
    let dir = std::env::temp_dir().join("core_base_crash_demo");
    core_base::diagnostics::init("crash-demo", "0.0.1", &dir).expect("init диагностики");
    core_base::diagnostics::record("шаг 1: открытие файла отчёта");
    core_base::diagnostics::record("шаг 2: расчёт показателей");

    println!("каталог отчётов: {}", dir.display());
    println!("ручная выгрузка: {:?}", core_base::diagnostics::export());
    panic!("демонстрационное падение: проверка отчёта о сбое");
}
