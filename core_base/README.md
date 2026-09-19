# core_base — общая база воркспейса

Внутренний крейт (`publish = false`), который подключают проекты из `Apps/Rust/*`
path-зависимостью. Задача — не дублировать один и тот же код в десяти проектах.

Архитектура и правила работы с общей базой: `ARCHITECTURE.md` в своём наборе правил
(`Rules_Zai/` для ZCode, `Rules_Antigravity/` для Antigravity).

## Модули и фичи

| Модуль | Фича | Что внутри |
|---|---|---|
| `config` | всегда | JSON-конфиг: загрузка/сохранение, ошибки |
| `sort_utils` | всегда | натуральная сортировка (`page2` < `page10`) |
| `diagnostics` | всегда | диагностика падений: кольцо журнала + отчёт при панике |
| `fs_utils` | `fs` (default) | файловые помощники |
| `mime_utils` | `mime` | MIME/расширения, определение картинок |
| `net_utils` | `net` | HTTP-клиент |
| `licensing` | `licensing` | проверка лицензионного ключа |
| `finance` | `finance` | риск-профили, фазы рынка, комбинирование шоков |
| `supervision` | `supervision` | изоляция паник и перезапуск фоновых задач |

Подключение — только нужные фичи, без лишних зависимостей:

```toml
core_base = { path = "../../../../Modules/core_base", default-features = false, features = ["finance"] }
```

## Диагностика падений (`diagnostics`)

Зависимостей нет: backtrace из `std`, время форматируется своим календарным
преобразованием. В релизе приложение падает молча — этот модуль оставляет след.

```rust
// один раз при старте, когда известен каталог данных приложения
core_base::diagnostics::init("FileSync", env!("CARGO_PKG_VERSION"), app_log_dir)?;
core_base::diagnostics::record("открытие БД портфеля");   // последние 500 строк попадут в отчёт
```

- при панике пишется `crash-<дата-время>.log`: текст паники, место, backtrace, хвост журнала;
- `export()` — сохранить отчёт вручную (кнопка «сохранить диагностику»);
- `last_crash(dir)` — путь к последнему отчёту (предложить отправить после перезапуска);
- хранятся последние 10 файлов, старые удаляются.

В Tauri v2 каталог: `app.path().app_log_dir()`; в v1: `app.path_resolver().app_log_dir()`.

## Фоновые задачи (`supervision`)

Задача, запущенная через `spawn`, при панике умирает молча — приём соединений,
наблюдатель за файлами, медиасервер перестают работать, а интерфейс выглядит живым.

```rust
tauri::async_runtime::spawn(core_base::supervision::guard("accept-loop", async move { … }));
tokio::spawn(core_base::supervision::supervise("наблюдатель", move || watch_once(dir.clone())));
```

`guard` — выполнить один раз, панику поймать и записать в журнал.
`supervise` — перезапускать с паузой 1 → 2 → 4 … до 30 секунд (штатное завершение
задачи перезапуска не вызывает). Обе — `async fn`: внешний запуск остаётся за
вызывающим, потому что `tokio::spawn` требует уже запущенного рантайма.

## Проверка

```bash
cd Modules/core_base
cargo fmt --all
cargo clippy --all-features --all-targets -- -D warnings
cargo test --all-features        # фичи finance/supervision в CI должны быть включены
```
