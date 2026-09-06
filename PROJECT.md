# PlanWise (daily-planner)

Task planner: Tauri v2 + React 19 + TypeScript + zustand + SQLite (rusqlite) + @dnd-kit.
Platforms: macOS (WidgetKit widget), Android (AlarmManager/Kotlin widgets). Web mode (browser, localStorage backend in `src/api.ts: browserApi`) — for development without Tauri.
Current version: 0.1.12 (0.1.11 — фикс наложения план-групп + тематический сплеш; releases in «Ready-made versions of applications/PlanWise»).

## Structure

- `src/` — frontend: `App.tsx` (root, reloads all tasks after every change), `store.ts` (zustand+persist, UI settings), `api.ts` (invoke wrappers + browser backend), `drag.tsx` (shared DndContext), `views/` (Day/Week/Month), `components/` (TaskCard, MiniCalendar, RightPanel, …).
- `src-tauri/src/` — `commands.rs` (commands + widget writes), `notify.rs` (notification scheduler: desktop — polling with adaptive sleep, Android — OS scheduling), `db.rs` (SQLite, WAL).
- `src-tauri/widgets/` — macOS WidgetKit extension; `scripts/bundle-macos.sh` — full build with .appex embedding.
- `legacy/` — old Flutter project (not involved).

## Commands

- Dev (web): `npm run dev` (browser backend, StrictMode double-render).
- Frontend build: `npm run build` (tsc + vite).
- Release macOS: `npm run build:macos` (= `scripts/bundle-macos.sh`: cargo tauri build + widget + signing).
- Android APK: `cd src-tauri && npx tauri android build --apk` (universal in gen/android/app/build/outputs/apk/universal/release/).
- Rust tests: `cd src-tauri && cargo test --lib notify::`.
- Rust static analysis: `cargo fmt && cargo clippy --fix --allow-dirty && cargo check`.

## Key decisions

- **Data changes**: any action → `reload()` in App (full task reload via 3 requests) → `write_widget_data` via 600 ms debounce (see `scheduleWidgetWrite` in App.tsx) + auto-export `autoSync.ts` (2 s debounce, if enabled).
- **Auto-sync** (`src/autoSync.ts`): file `daily-planner-sync.json` in the configured folder — full backup on data change + check once a minute (last-write-wins). Rust commands `write_sync_file`/`read_sync_file`; unavailable on Android (content://), manual export there.
- **App exit**: on macOS closing the last window does NOT terminate the process (run loop in lib.rs: `ExitRequested` → `prevent_exit`, Dock click → `Reopen` restores the window). Explicit exit — the "Exit" button in settings / BACK on Android (command `exit_app` sets the `ALLOW_EXIT` flag).
- **Scheduler** (`notify.rs`): tick → sleep until the nearest event (reminder due/digest/midnight), cap 30 min; `wake_scheduler()` wakes on settings changes and (desktop) task changes. Android — fixed 60 s sync-model loop. Exact alarms — SCHEDULE_EXACT_ALARM + USE_EXACT_ALARM in AndroidManifest (otherwise the plugin sets inexact ones, notifications get delayed). Per-task reminder «До выезда» (`travelNotifyMinutes`): «Пора собираться» за N мин до выезда (= start − `travelTime`), раньше, чем «Пора выезжать».
- **TaskCard memoized** (React.memo + `taskEquals` by fields): after reload all task objects are new, reference comparison is always false.
- **Time conflicts**: the `conflictId` selector returns a primitive (id|null) — subscribing to the whole `s.tasks` would re-render all cards.
- **Notification → task card (deep-link)**: a reminder carries `taskId` via `.extra("taskId", …)`; the frontend listens to the plugin's `actionPerformed` at module scope (catches cold start) → `focusTaskId` → a global `AddTaskModal`. Cold-start splash — themed `windowBackground` `#f4f5f7`/`#121316`. Android reminders use `large_body` (BigTextStyle) so the full text is visible expanded.
- **ErrorBoundary** around `App` (`main.tsx`): any unhandled render error shows a visible error + reload button instead of a silent white screen. On the device the white screen is NOT reproduced (launcher/fresh-install/notification-intent launch all load fine) — likely a data- or WebView-version-specific render crash; the boundary surfaces its cause.
- **«Когда-нибудь» plan groups**: the section is split into collapsible «Когда-нибудь» / «В течение недели» / «В течение месяца» by the soft deadline `dueEpochDay` (no separate task types). Plan-tasks are ALSO shown in the week/month grid on their deadline day (`tasksForDay` matches `dueEpochDay` for someday tasks). Protection from desync: `move_task` keeps a someday task as a plan-task (updates `due_epoch_day`), `set_someday` clears it — so dragging/editing a plan-task in the grid does NOT turn it into a day task.

## Pitfalls (verified by measurements 15.08)

- **dnd-kit sensors**: option literals in render break `useSensor` memoization → `activators` → internalContext is recreated → RE-RENDER OF ALL useDraggable/useDroppable on any store change. Options — module-level constants (`drag.tsx`), DndContext callbacks — useCallback.
- **zustand selectors**: a selector returning an array/object without shallow — infinite loop/excess renders; return a primitive.
- Vite caches node_modules: library patches require `vite dev --force`.
- APFS case-insensitive; Rust builds — into the shared `/Volumes/Kingston/My_projects/.cache/target` (see `~/My Project/Rust_Workspace/ARCHITECTURE.md`), there must be no local target/.
- **Android build**: gradle cache `~/.gradle/caches/8.14.3` can corrupt on abrupt interruptions (metadata.bin kotlin-dsl) — reset with `rm -rf` of the directory. libsqlite3-sys requires NDK clang in PATH: `export PATH="$HOME/Library/Android/sdk/ndk/*/toolchains/llvm/prebuilt/darwin-x86_64/bin:$PATH"` before `tauri android build` (otherwise "sccache: cannot find binary path"). gradlew does not work directly (the rust task waits for a WebSocket from the tauri CLI).
- **Android build under memory pressure**: the gradle daemon dies ("daemon disappeared", corrupted kotlin-dsl metadata) when RAM is low — this is NOT the cache. Fix: free memory (close Android Studio — it holds a lock on gen/android!), temporarily add to `gradle.properties` `org.gradle.workers.max=1` + `kotlin.compiler.execution.strategy=in-process`; revert after the build. The universal build (4 ABIs) is finicky — `--target aarch64` is enough for a phone.
- **Force-stop on Android cancels all alarms** (including At notifications) — OS protection, not a bug: swipe from recents is safe, force-stop from settings is not.
- **Plan-group containers («Когда-нибудь»/«Неделя»/«Месяц»)**: don't use `flex: 1 1 0` on them — in a short panel three expanded groups each collapse to 0 height and their headers overlap. Each group `flex: 0 0 auto` (natural height), the whole column scrolls.
- **Android 12+ cold-start splash**: `windowSplashScreenBackground` defaults to WHITE and flashes before the themed window (esp. in dark theme). Set splash bg + icon bg in `values/themes.xml` and `values-night/themes.xml` (`tools:targetApi="s"`).
- The shared target dir `/Volumes/Kingston/My_projects/.cache/target/release` may disappear (background cleanups/other projects) — rebuild before distributing artifacts.

## Battery measurements (method: `top -l 2 -pid <PID> -stats cpu,power,rsize`)

- idle before edits: CPU 0.1–0.2%, energy 0.1–0.2 (peaks 1.7), minimized 0.3–1.2 — App Nap did not kick in because of the 60 s scheduler ticks.
- Row renders: a checkbox click rendered ALL rows (30 with 5 tasks in dev) — after memoization 2 (dev StrictMode ×2; in prod 1).
- Android (Pixel 7 Pro, batterystats): background 10 min with screen off — CPU UID 0.000138 h (~0.5 s), "nothing executed"; no crashes in logcat; the widget is updated by an OS alarm every 15 min. UI on cold start: gfxinfo 15% janky (median 5 ms) — re-measure after warmup/unlock.

Detailed reports: `docs/reports/`.
