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

## Лицензия платного приложения (`licensing`)

Эталон — `Apps/Rust/TensorMedia/src-tauri/src/licensing.rs` (три команды Tauri: `check_activation_status`,
`verify_license`, `deactivate_license`) + экран активации в его `App.tsx`. Для нового платного приложения:

1. `Cargo.toml`: `core_base` с `features = ["licensing"]`, `machine-uid = "0.3"`, `reqwest` (rustls).
2. Скопировать `licensing.rs`; заменить `ALLOWED_VARIANTS` на **свой вариант + оба варианта Pass**
   (`2199229` навсегда, `2199232` год) и `SALT` на уникальную строку приложения; три команды — в `invoke_handler`.
3. Фронтенд: показывать экран активации, пока `check_activation_status().activated == false`; ключ —
   `verify_license`; `.lic`-файл и диплинк `<app>://activate?key=` — по образцу TensorMedia.
4. Проверка: `cargo test --features licensing licensing` + живая цепочка validate → activate → повторная
   активация (должен быть отказ по лимиту) → deactivate на тестовом ключе.

Перепроверка: `LicenseInfo.created_at` (из ответа LS) + `settled()` — разовая покупка (`expires_at` нет),
у которой последняя успешная онлайн-проверка позже `created_at + 60 дн` (`REFUND_WINDOW_SECS`), больше не
перепроверяется и офлайн работает бессрочно; подписки — прежние 7 дн / 30 дн. Используйте
`info.recheck_due(now)` / `info.offline_grace_over(now)`, не свободные функции. `Revalidation::Valid
{ created_at }` — обновить кеш. Имя устройства в `instance_name` — читаемое («<host> · <App>»).

Подводные камни:
- **Android**: `machine-uid` 0.3 не поддерживает `target_os = "android"` — glue из TensorMedia там не
  соберётся. Для Android-сборки нужен свой идентификатор устройства (UUID в app data либо ANDROID_ID через
  плагин); привязка к железу слабее, это решение владельца.
- **Лимит активаций — на ключ, не на приложение** (задаётся на варианте в LS, действует на ключи, созданные
  после правки). Каждое приложение на каждом устройстве занимает слот: лимит Pass = 3 × число платных
  приложений (сейчас TensorMedia + ComiFlow + Convertia = 9). Бесплатные приложения слотов не занимают.
- Экран активации живёт во фронтенде и обходится прямым `invoke`. Эталон закрытия — `require_activated`
  в TensorMedia 2.0.100: локальный шлюз (кэш расшифровывается, `activated`, срок, офлайн-запас; без сети и
  без записи) в первых строках входных команд + статик `REVOKED`, который поднимает онлайн-перепроверка.
  Перед релизом прогнать `TM_REAL_DATA_DIR=<каталог данных> cargo test real_cache -- --ignored` на машине
  с реальной активацией: шлюз не должен запирать платящего пользователя.
- ID вариантов — из тестового режима LS; перед запуском сверить с `Website/src/constants/storeConfig.tsx`.

## Проверка

```bash
cd Modules/core_base
cargo fmt --all
cargo clippy --all-features --all-targets -- -D warnings
cargo test --all-features        # фичи finance/supervision в CI должны быть включены
```
