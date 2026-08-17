# Ежедневник (daily-planner)

Планировщик задач: Tauri v2 + React 19 + TypeScript + zustand + SQLite (rusqlite) + @dnd-kit.
Платформы: macOS (виджет WidgetKit), Android (виджеты AlarmManager/Kotlin). Веб-режим (браузер, localStorage-бэкенд в `src/api.ts: browserApi`) — для разработки без Tauri.

## Структура

- `src/` — фронтенд: `App.tsx` (корень, reload всех задач после каждого изменения), `store.ts` (zustand+persist, настройки UI), `api.ts` (invoke-обёртки + браузерный бэкенд), `drag.tsx` (общий DndContext), `views/` (Day/Week/Month), `components/` (TaskCard, MiniCalendar, RightPanel, …).
- `src-tauri/src/` — `commands.rs` (команды + запись виджетов), `notify.rs` (планировщик уведомлений: десктоп — поллинг с адаптивным сном, Android — OS-планирование), `db.rs` (SQLite, WAL).
- `src-tauri/widgets/` — macOS WidgetKit-расширение; `scripts/bundle-macos.sh` — полная сборка с встраиванием .appex.
- `legacy/` — старый Flutter-проект (не участвует).

## Команды

- Dev (веб): `npm run dev` (браузерный бэкенд, StrictMode double-render).
- Сборка фронтенда: `npm run build` (tsc + vite).
- Release macOS: `npm run build:macos` (= `scripts/bundle-macos.sh`: cargo tauri build + виджет + подпись).
- Android APK: `cd src-tauri && npx tauri android build --apk` (universal в gen/android/app/build/outputs/apk/universal/release/).
- Rust-тесты: `cd src-tauri && cargo test --lib notify::`.
- Статанализ Rust: `cargo fmt && cargo clippy --fix --allow-dirty && cargo check`.

## Ключевые решения

- **Смена данных**: любое действие → `reload()` в App (полная перезагрузка задач 3 запросами) → `write_widget_data` через дебаунс 600 мс (см. `scheduleWidgetWrite` в App.tsx) + автоэкспорт `autoSync.ts` (debounce 2 с, если включён).
- **Автосинхронизация** (`src/autoSync.ts`): файл `daily-planner-sync.json` в заданной папке — полный бэкап при изменении данных + проверка раз в минуту (last-write-wins). Rust-команды `write_sync_file`/`read_sync_file`; на Android недоступна (content://), там ручной экспорт.
- **Выход из приложения**: на macOS закрытие последнего окна НЕ завершает процесс (run-цикл в lib.rs: `ExitRequested` → `prevent_exit`, клик по Dock → `Reopen` возвращает окно). Явный выход — кнопка «Выйти» в настройках / BACK на Android (команда `exit_app` ставит флаг `ALLOW_EXIT`).
- **Планировщик** (`notify.rs`): тик → сон до ближайшего события (due напоминаний/дайджест/полночь), потолок 30 мин; `wake_scheduler()` будит при изменении настроек и (десктоп) задач. Android — фиксированный 60-с цикл sync-модели. Точные алармы — SCHEDULE_EXACT_ALARM + USE_EXACT_ALARM в AndroidManifest (иначе плагин ставит неточные, уведомления задерживаются).
- **TaskCard мемоизирован** (React.memo + `taskEquals` по полям): после reload все объекты задач новые, сравнение по ссылке всегда ложно.
- **Конфликты времени**: селектор `conflictId` возвращает примитив (id|null) — подписка на весь `s.tasks` рендерила бы все карточки.

## Грабли (проверено замерами 15.08)

- **dnd-kit сенсоры**: литералы опций в рендере ломают мемоизацию `useSensor` → `activators` → internalContext пересоздаётся → РЕ-РЕНДЕР ВСЕХ useDraggable/useDroppable на любое изменение стора. Опции — модульные константы (`drag.tsx`), колбэги DndContext — useCallback.
- **zustand селекторы**: селектор, возвращающий массив/объект без shallow — бесконечный цикл/лишние рендеры; возвращает примитив.
- Vite кэширует node_modules: патчи библиотек требуют `vite dev --force`.
- APFS case-insensitive; Rust-сборки — в общий `~/.cargo-shared-target` (см. `~/My Project/Rust_Workspace/ARCHITECTURE.md`), локальных target/ быть не должно.

## Замеры батареи (методика: `top -l 2 -pid <PID> -stats cpu,power,rsize`)

- idle до правок: CPU 0.1–0.2%, energy 0.1–0.2 (пики 1.7), свёрнутое 0.3–1.2 — App Nap не гасил из-за 60-с тиков планировщика.
- Рендеры строк: клик по чекбоксу рендерил ВСЕ строки (30 при 5 задачах в dev) — после мемоизации 2 (dev StrictMode ×2; в проде 1).
- Android (Pixel 7 Pro, batterystats): фон 10 мин с погашенным экраном — CPU UID 0.000138 ч (~0.5 с), «nothing executed»; крашей в logcat нет; виджет обновляется OS-будильником каждые 15 мин. UI на холодном старте: gfxinfo 15% janky (медиана 5 мс) — после прогрева/разблокировки замер повторить.

Отчёты детальные: `docs/reports/`.
