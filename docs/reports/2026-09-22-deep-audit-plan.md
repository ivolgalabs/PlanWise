# PlanWise deep audit + updated fix plan (2026-09-22)

Second-pass audit ("deeper than 2026-09-18"). Scope: whole active tree (src/, src-tauri/, migrations,
capabilities, CI, plugin-bridge Kotlin, widget contract). Method: 4 parallel deep-read lanes
(Rust commands/data, notify scheduling math, frontend state/data flows, UI date-time formulas) +
infra/config pass by the session; every top finding re-verified first-hand; two agent findings
refuted after direct code checks (listed at the end so nobody fixes a non-bug).

## Check status (HEAD ebb51e9, v0.1.15, run 2026-09-22)

- `cargo clippy --all-targets -- -D warnings`: clean (CI-parity gate).
- `cargo test`: 16 passed / 0 failed.
- `npm test` (tsc --noEmit) and `npm run build`: clean; bundle 395.7 kB (121 kB gzip).
- XSS sweep of src/ (`innerHTML`/`dangerouslySetInnerHTML`/`eval`/`document.write`): none.
- CSP (tauri.conf.json): `script-src 'self'` (no unsafe-inline in prod) — OK.

## Verdicts on the 2026-09-18 plan (17 items)

FIXED (verified): #2 digest window from configured hour (notify.rs:716-717), #3 jump-to-day resets
search, #4 widget stamp on Ok, #5 TOCTOU single-lock in upsert/move/restore (commands.rs:128+),
#6 someday `past` styling (SearchResults.tsx:160), #8 ALLOW_EXIT removed, #9 add_attachment releases
mutex before disk write, #10 widget queries deduped (16 vs 23), #11 parseExportedAt reverted +
`exporting` flag, #12 useShallow in App, #13 conflict map (correct incl. containment/zero-length),
#14 confirmPromote try/catch, #17 npm test present (CI runs it). Startup milestones shipped (0.1.14).

HALF-FIXED (residual defects folded into findings below):
- #1 SECURITY sync-path pin — pinned to filename only; symlink/foreign-dir still possible via the
  `path` parameter, and the fs-plugin `$HOME/**` scope (N2) bypasses the pin entirely.
- #7 Android pending_ids guard — code landed but is dead (plugin `show()` never persists; N1).
- #12 useStore() — SettingsPanel.tsx:184-238 and drag.tsx:366 still full-store (N16).
- #15 error toasts — drag.tsx:213-248, ArchivePanel:29,121, SettingsPanel:411-431 still bare awaits (N13).
- #16 browser-fallback updatedAt — only upsertTask stamps it (N24).

## NEW findings (ranked)

### P0 — critical (feature half-broken / security)

- **N1. Android reminders do not survive reboot; the pending guard and cancel sweep are dead.**
  `NotificationPlugin.show()` (tauri-plugin-notification 2.3.3, NotificationPlugin.kt:135-150) calls
  `manager.schedule()` but never `notificationStorage.appendNotifications` — only `batch` persists.
  `getPending` (:179-183) reads that storage, so `pending()` is always empty. Consequences, all
  verified in notify.rs: (a) the reschedule guard (:634,:658) never blocks -> every 60 s tick
  re-schedules every alarm (the churn ecf431c intended to remove); (b) the cancel loop over
  `pending_ids` (:666) iterates an empty set -> alarms of deleted/completed/moved tasks are never
  cancelled (stale fire at the old time + double fire with the new one); (c) BOOT_COMPLETED restore
  restores from an empty store -> after a device reboot all pending reminders/digest alarms are lost
  silently (missed events are then dropped by the `due > now` filter).
  Fix: schedule via plugin `batch` (`run_mobile_plugin("batch", …)`) so storage is populated — or keep
  scheduled ids in Rust state and diff/cancel against that instead of `notif.pending()`.
- **N2. SECURITY — webview fs access to `$HOME/**` defeats the sync-path pin.**
  `capabilities/default.json` grants `fs:read-files` + `fs:write-files` with `fs:scope` covering
  `$HOME/**`, `$APPDATA/**`, `$CACHE/**`, `$DOWNLOAD/**`, `$DOCUMENT/**`, `$PICTURE/**`, and
  `SettingsPanel.tsx:6,477,496` uses `readTextFile`/`writeTextFile` of `@tauri-apps/plugin-fs` for
  manual export/import. A compromised renderer can read/overwrite any file under the home directory
  (SSH keys, browser profiles, …) regardless of the pinned sync filename. Secondary: the
  `read_sync_file`/`write_sync_file` commands still take a JS-supplied `path` and validate only
  `file_name() == "daily-planner-sync.json"` (commands.rs:861-868) — a symlink by that name escapes.
  Fix: drop the plugin-fs dependency and the fs permissions entirely; move manual import/export into
  Rust commands where the path comes from a Rust-side dialog (webview never supplies paths); make the
  sync commands resolve the folder from stored settings and ignore any path argument.

### P1 — high (data loss / resource burn / timing)

- **N3. `write_sync_file` is not atomic** (commands.rs:882-888: plain `std::fs::write`, no
  temp+rename/fsync). A crash/power cut tears the sync/backup JSON; the importer silently skips it
  (autoSync treats read errors as "no file") -> the sync channel is quietly dead until the next edit.
  Fix: temp file + rename, same pattern as `save_prefs` (notify.rs:115+).
- **N4. Auto-export runs on EVERY reload, including auto-import reloads -> cross-device ping-pong.**
  `reload()` ends with `scheduleAutoExport()` (App.tsx:416-419); the auto-import path calls `reload()`
  after import. Result with 2 devices: import -> export (2 s debounce, new exportedAt) -> other device
  imports -> export -> … an endless exchange of full backups. Fix: schedule the export from mutation
  callbacks only, never from the read-only reload.
- **N5. Auto-export re-serializes base64 of ALL attachments on every change** (commands.rs:610-647).
  One 25 MB attachment -> ~33 MB JSON written on every edit burst (2 s debounce): disk, battery and
  sync-folder churn; with N4 it multiplies across devices. Fix: routine export carries attachment
  metadata only; full bytes only in manual backup (or hash-diff + unchanged skip).
- **N6. Mutations do not wake the scheduler.** `wake_scheduler()` is called only from
  `set_notification_prefs` (commands.rs:902) and `write_widget_data` (:954); upsert/delete/move/
  set_someday/archive/restore/import never call it. Scheduling correctness depends on the frontend's
  600 ms debounced widget write, and the Android widget writes SQLite directly from a separate
  process (WidgetData.kt:173-259) with no wake at all -> up to 30 min stale schedule (desktop) and
  stale/cancel-less alarms (Android, compounding N1). Fix: call `wake_scheduler()` at the end of every
  mutating command (cheap condvar signal); have the widget receiver broadcast to the app.
- **N7. Import: disk/lock/atomicity cluster** (commands.rs:677-816):
  (a) attachment files are written to disk BEFORE `tx.commit()` (:791 vs :809); on any error or crash
  the transaction rolls back but written files stay (the orphan cleanup :811 runs only on success);
  (b) the whole import (base64 decode + fs writes of a payload up to 100 MB) runs while holding the
  global DB mutex (:682) — the UI stalls for seconds on large backups;
  (c) the stored-name filter (:784-788) allows names built from dots only (`..` -> `files_dir/..` ->
  EISDIR -> import aborts) — path separators ARE rejected so arbitrary write is not reachable, but the
  check is fragile. Fix: strict name pattern (no `.`/`..`/leading dot), decode outside the lock, write
  files after commit (or clean up on rollback).
- **N8. DST gap: `to_local` falls back to reinterpret-as-UTC** (notify.rs:361-365). A task at a
  non-existent local wall time (spring-forward hole) or an ambiguous fall-back time goes through
  `Local.from_utc_datetime` -> its timestamp and `due_unix_minute` id shift by the whole UTC offset,
  while `check_reminders` compares naive wall clocks -> Android alarm and desktop window disagree by
  hours. All reminder instants inherit this via `due_at` (:824). Fix: `.earliest()`/`.latest()`
  instead of the UTC fallback.

### P2 — medium (edge cases, UX, consistency)

- **N9.** `same_as_db` compares only time/duration/date (commands.rs:132-148) -> restoring/unarchiving
  into an overlapping slot with unchanged time bypasses `check_time_overlap`.
- **N10.** Android digest "tomorrow" pre-arm freezes the task list at schedule time (notify.rs:617-643):
  tasks added in the evening miss the morning digest; an empty list at pre-arm skips a day entirely.
- **N11.** `day_summary_hour` is never validated/clamped in `load_prefs` (notify.rs:106-109); raw
  `as u32` casts at :712 and :619,:625 — a corrupted notify-prefs.json (hour < 0) silently disables
  the desktop digest forever. Fix: clamp 0..23 at load.
- **N12.** Reminder-interval semantics: opt-out is `== Some(0)` only (:280,:403) — negative
  `notify_minutes` falls back to global intervals and a negative `remind_minutes` entry fires AFTER
  task start (`due_at`, :824); the UI also allows removing every interval chip (store.ts:244-251) ->
  zero reminders with the toggle ON, no signal.
- **N13.** Bare `await api.*` without try/catch remain: drag.tsx:213-248 (setSomeday/moveTask/
  upsertSubtask branches), ArchivePanel.tsx:29,121-124, SettingsPanel.tsx:411-431 — an overlap
  rejection is an unhandled promise rejection with UI/DB desync (half of prior #15).
- **N14.** `reload()` uses `Promise.all` (App.tsx:386-393) — one failing query freezes regular AND
  archived data; `loadError` is never cleared on later success (:405-411). Fix: `Promise.allSettled` +
  clear-on-success.
- **N15.** autoSync: a read error (revoked permission, broken path) is indistinguishable from "file
  absent" (autoSync.ts:84-89) -> import silently dead forever; `exporting` has no watchdog — one hung
  write blocks import until restart.
- **N16.** `useStore()` without selector in SettingsPanel.tsx:184-238 and drag.tsx:366 — the whole
  1631-line panel re-renders on every store tick (autoSyncLastAt updates each export).
- **N17.** `format_interval` truncates minutes (notify.rs:806-817): a 90-min lead renders "через 1 ч";
  preposition "через" contradicts TS "за …" (SettingsPanel.tsx:36-44). Fix: h+m like `fmtRemindInterval`.
- **N18.** SettingsPanel.tsx:1164 uses single-mod `(x + 1440) % 1440` for the departure label — for
  travelTime > time+1440 (DurationSelect allows up to 10080) it renders negative garbage ("-22:-40");
  also no "накануне" note, diverging from `travelTimeText` (date.ts:292, the twin Rust copy at
  notify.rs:433 is correct). Fix: reuse `travelTimeText`; kill the 3rd copy.
- **N19.** AddTaskModal auto-done ignores duration (273-275): a task running right now (10:00-10:30
  created at 10:05) is marked done. Fix: past = day<today || (day==today && start+duration <= nowMin).
- **N20.** `TaskPattern` drops `travelNotifyMinutes` (api.ts:153-167, AddTaskModal collect) — tasks
  created from a template can never carry "time to get ready".
- **N21.** No range validation at the IPC trust boundary and no DB CHECKs: `time_minutes` 0..1439
  (V2), `difficulty` 0..3 (V8), `due_epoch_day` range (V13) — `upsert_task` and import accept raw
  values. Fix: clamp in upsert_task/import + CHECK migration (V14).
- **N22.** Desktop reminder catch-up window is 15 min (notify.rs:841) while comments promise ±2 min
  (:17,:339) — reminders missed by >15 min vanish with no trace. Decide (deliver marked "late" vs
  drop+document) and align comments.
- **N23.** An empty day is stamped "digest sent" without sending (notify.rs:727-730) — a task added
  later that morning gets no digest, contradicting the 6-hour catch-up window.

### P3 — low (hygiene)

- **N24.** Browser dev-mode: `load()` returns `[]` on corrupt localStorage (api-browser-fallback.ts:24-26)
  — silent data loss in dev; `updatedAt` stamped only in `upsertTask` (parity gap with Rust).
- **N25.** `stable_id` mod 999_999 (notify.rs:493-499): birthday collisions near ~1000 events in the
  7-day horizon -> silently lost alarm (needs N1's id bookkeeping anyway).
- **N26.** Android loop drifts: sleep(60) after tick -> period 60 s + tick, never re-aligns to the
  minute (notify.rs:209-211).
- **N27.** zustand persist has no `version`/`migrate` and merges unvalidated shapes (store.ts:264-329)
  — a future field rename silently resets user settings.
- **N28.** Assorted: `mark_fired` prune comment is false (notify.rs:131,148-151); wake comment
  contradicts code (:172-174 vs commands.rs:954); PROJECT.md:5 still says "Current version: 0.1.14";
  toast-listener race under StrictMode (App.tsx:185-196); widget-write timer not cleared on unmount
  (App.tsx:65-79); `exit_app` button has no confirmation (SettingsPanel.tsx:1550-1561); stale
  `colorScheme` when only a custom theme slot changes (App.tsx:265-293); `useSubtasks` has no
  per-request seq guard (useSubtasks.ts:38-41); `TASK_COLUMNS`/`?N` hand-synced (commands.rs:15);
  `app_files_dir` silently falls back to CWD (commands.rs:987); `query_by_day` swallows SQL errors
  (commands.rs:1038); dual core_base copies (repo `core_base/` for CI vs `Modules/core_base` for local
  builds — contents verified identical today, drift risk is process-level).
- **N29.** Index gaps (V11): no `(archived, date DESC, updated_at DESC)` for `get_archived_tasks`,
  no composite for the notify query (`date, is_done, archived, someday`) — full scans as data grows.

## Formula checks (the "формулы" question)

Verified OK (with boundary tests): epoch-day <-> date (719_163 constant, pre-1970 negatives, leap
2000/2024/2100, DST-safe construction), `startOfWeek` mondayFirst toggle, month nav clamp (Jan 31 ->
Feb 28/29, Dec->Jan), `intervalsOverlap` (touching intervals do NOT conflict, zero-length = 1 min,
containment symmetric), conflict map correctness, travel formulas (`getReady = start-(travel+lead)`
fires strictly before `leave = start-travel`; previous-day wrap) and their TS<->Rust identity via
double-mod, `dueEpochLabel`/`bucket` +7/+30 boundaries consistent, archive threshold `date < today-1`
identical in Rust and TS, search 7-day window (today..+6), LWW compare, import limits (100 MB / 100k),
digest window from configured hour (prior fix confirmed), "move to past = done" CASE (commands.rs:76-79).

WRONG/edge (each has a finding number): single-mod departure label (N18), `format_interval` minute
truncation (N17), DST `to_local` UTC fallback (N8), unclamped `day_summary_hour as u32` (N11),
hour-granular catch-up window drops its last minute (N22), auto-done ignores duration (N19),
`sched` 7-day horizon can exclude last-day dues computed early morning (self-heals within a day —
note only), `pickTime` missing 0..1439 clamp (TimePicker.tsx:63 — barely reachable: `type="time"`
rejects 24:00).

## Refuted after first-hand re-check (do NOT "fix")

1. "`move_task` clears `someday` and breaks the plan-task invariant" — false: move_task has an explicit
   someday branch (commands.rs:308-314) that moves `due_epoch_day` and keeps `someday=1`;
   `move_task_to_date` (`someday = 0` at :75) runs only for regular tasks.
2. "Import with a missing `tasks` field wipes the DB" — false: `BackupDoc.tasks` has no
   `#[serde(default)]` (commands.rs:669) so a missing field fails the whole import; an explicit empty
   array is a legitimate "replace with empty backup".
3. "`..` in storedName = path traversal" — not exploitable: separators are filtered (commands.rs:784-788)
   and `files_dir/..` is a directory (EISDIR -> rollback). Hardening kept as N7(c), severity lowered.
4. "core_base path does not exist / build broken on checkout" — false on this machine: the path
   resolves (`/Volumes/Kingston/My_projects/Modules/core_base`) and matches the repo copy
   (diff: only .git/.DS_Store/.remember). Residual dual-copy process risk -> N28.
5. "WidgetData.kt CONFLICT_REPLACE wipes travel_notify/due_epoch_day" — only on UUID collision
   (fresh UUID per quick-add) -> theoretical; lowered to N28-adjacent LOW.

## Optimization / quality analysis

Done well (keep): date math is DST-safe and round-trip tested; overlap and travel formulas are
consistent across TS/Rust; conflict map is O(n) per reload with a WeakMap cache; TaskCard memoization;
CSP without unsafe-inline in prod; atomic `save_prefs`; migrations are per-file atomic (refinery);
startup milestones give crash triage; codebase is lean (no speculative abstractions — ponytail view);
clippy -D warnings clean.

Structurally weak (improve, in impact order):
1. Notification timeliness is owned by a frontend debounce (`write_widget_data`) instead of the
   mutating commands themselves (N6) — split the channels.
2. Backup channel = "all bytes on every change" (N4+N5) with non-atomic writes (N3) and error-blind
   import detection (N15) — redesign as metadata-always / bytes-on-demand with atomic commits.
3. Webview privilege model contradicts the sync-path hardening (N2) — least privilege: no plugin-fs.
4. Departure formula exists in 3 copies (date.ts:292, SettingsPanel:1164, notify.rs:433) — one helper.
5. Range validation lives only in the UI; IPC/DB trust boundary is open (N21) — clamp + CHECK.
6. Test pyramid is inverted: 16 Rust tests cover date edges well, TS has zero tests (`npm test` =
   tsc). Cheap win: vitest for `date.ts` formulas and autoSync LWW — the two regression-prone spots.
7. `TASK_COLUMNS` + `?N` and cross-language widget SQL are hand-synced — a contract test
   (`pragma_table_info` vs const) would catch drift mechanically.

## Suggested fix order (updated)

1. **P0**: N1 (Android notification persistence/cancel — restore the feature) + N2 (SEC: strip
   plugin-fs, Rust-side dialogs).
2. **P1 backup/sync channel**: N3, N4, N5, then N15; **P1 scheduling**: N6; **P1**: N7, N8.
3. **P2** in batches: correctness (N9, N11, N12, N17-N21), UX/robustness (N10, N13-N16, N22, N23).
4. **P3** hygiene + formula tests (N24-N29) + refuted-list comments where docs mislead.

Rough effort: P0 ~1-2 sessions, P1 ~1 session, P2 ~2 sessions, P3 ~1 session.

## Applied in this session (2026-09-22)

Verified: `cargo clippy --all-targets -- -D warnings` clean, `cargo test` 20/20 (4 new tests),
`npm test` + `npm run build` clean.

- **N1** (`f151846`) — Android scheduling moved to the Kotlin bridge: `WidgetPushPlugin.scheduleBatch`
  mirrors the plugin's `batch` (manager.schedule + storage.appendNotifications) and Rust
  `notify::schedule_batch` sends the same JSON shape `show()` used to send. Alarms are persisted
  again: `pending()` is populated (guard + cancel sweep work) and the plugin's BOOT receiver has
  something to restore after a reboot. Device verification still needed (runtime behaviour).
- **N2** (`945f23b`) — capabilities split by platform: desktop `default.json` has no fs permissions,
  `mobile.json` keeps them for Android content://. Manual desktop export/import moved into Rust
  (`export_backup`/`import_backup`: Rust-side dialog + atomic write); SettingsPanel keeps the
  plugin-fs path only under `isAndroid()`. Sync commands take a FOLDER and join the fixed file name
  in Rust — the symlink/foreign-path hole is closed.
- **N3** — `write_sync_file` and `export_backup` write via tmp+rename (`write_atomic`).
- **N4** — auto-export is scheduled only from mutations (`App.onMutation`), never from `reload()`.
- **N5 (mitigated)** — `export_json` emits `contentHash`; auto-export skips unchanged content. Known
  ceiling: the routine export still embeds attachment bytes — a metadata-only format would break
  attachments on cross-device restore, so the format change is deferred.
- **N6** — `wake_scheduler()` in upsert/delete/move/set_someday/archive/restore/import.
- **N7** — import: parse + base64 decode before the DB lock (`prepare_import`/`apply_import`), strict
  attachment-name validation (dot-only names rejected; new tests), files from a failed import removed.
- **N8** — `to_local` no longer reinterprets a local time as UTC (DST gap/ambiguity).
- **N11** — `sanitize_prefs` clamps the digest hour and drops non-positive intervals (on load and on
  `set_notification_prefs`).
- **N15** — `read_sync_file` returns `Result<Option<String>, String>`: a read error is no longer
  conflated with "file absent"; autoSync reports it (throttled toast) and has an export watchdog.

Still open, in plan order: N9, N10, N12, N13, N14, N16, N17-N23 (notification text, travel label,
auto-done boundary, pattern travelNotify, IPC range validation + DB CHECKs, catch-up window vs
comments), N24-N29 (browser fallback, stable_id collisions, 60 s drift, persist version, index gaps,
hygiene). Android runtime behaviour (reboot restore, cancel of stale alarms) needs a device pass
during the next Android build.

## P2 batch (2026-09-22, commit fa72e59)

Rust: `sanitize_task` clamps every field fed from the webview and from a backup file (time 0..1439,
difficulty 0..3, durations ≤168 h, reminder interval ≤30 days) — applied in `upsert_task` and in
`prepare_import`; `same_as_db` now also compares `someday/archived/is_done` so un-archiving or leaving
the "Someday" group no longer slips into an occupied slot past the overlap check; interval semantics
fixed (0 and negative values = "do not remind", previously a negative value silently fell back to the
global intervals); notification text renders "за 1 ч 30 мин" instead of "через 1 ч" (minutes were
truncated) with the same preposition as the settings UI; the desktop catch-up window became a named
constant with an honest comment (it was 15 minutes while comments claimed ±2); an empty day is no
longer stamped as "digest sent" (a task added later inside the window now still gets the digest);
`stable_id` uses the whole positive i32 instead of `% 999_999` (real collisions at ~1000 scheduled
events); the Android 60 s loop is aligned to the minute boundary (it drifted by the tick duration);
errors from `app_data_dir` and from the widget day query are logged instead of swallowed; V14 adds
the missing indexes (archived/date/updated_at and date/is_done/archived/someday). Deliberate
non-change: DB-level `CHECK` constraints were rejected — SQLite cannot add a CHECK without rebuilding
`tasks` (with FK cascades from subtasks/attachments), and the app is the only writer, so the range
invariants live in one place (app code) instead of two.

Frontend: `reload` uses `Promise.allSettled` (one failing query no longer freezes the other data) and
a successful reload clears the error banner that previously stuck forever; command rejections now
surface as toasts in drag.tsx (five branches), ArchivePanel (single restore and the done checkbox) and
SettingsPanel (category save/delete); SettingsPanel subscribes to its 52 fields through `useShallow`
(full-store subscription re-rendered the 1631-line panel on every store tick) and DragGhost uses a
selector; the departure label reuses `travelTimeText` (the inline copy produced garbage for travel
longer than a day and lost the "накануне" note); auto-done is computed from the task END (a task
running right now is no longer marked done in its start minute); an empty interval list now shows a
warning; leaving the app asks for confirmation; the widget timer and the toast listener are cleaned up
properly; `useSubtasks` guards against a stale response after a taskId change; the persisted settings
got `version`/`migrate` plus validation of numeric settings and reminder intervals; the browser
fallback keeps a copy of corrupt localStorage data (and tells the user) instead of silently treating
it as an empty database, and stamps `updatedAt` on every mutation like Rust does.

Verification after the batch: `cargo clippy --all-targets -- -D warnings` clean, `cargo test` 20/20,
`npm test` (tsc) and `npm run build` clean.

### Lesson from the Android build (verification paid off)

The first Android build compiled the new Kotlin and failed for a real reason: `jsonMapper()` returns
`com.fasterxml.jackson.databind.ObjectMapper`, which the plugin AAR keeps as an `implementation`
dependency — not visible to the app module. Reading the plugin source also showed that
`Notification.sourceJson` is never assigned in Kotlin (only `parseArgs` fills it) and that its own
restore path re-appends parsed notifications with a null `sourceJson`. The design therefore changed:
the alarm stays on the proven `show()` path and the persistence is a small bridge command that writes
`sourceJson` into the plugin's SharedPreferences. The Android build then passed: the bridge compiles
and the APK is produced.

It also caught a second real defect that a desktop-only check cannot see: `Timelike` was imported under
`#[cfg(not(target_os = "android"))]` while the new Android `next_sleep` calls `now.second()`.
`cargo check --target aarch64-linux-android` is therefore part of the routine verification for
anything behind `cfg(target_os = "android")`.

Final state of this batch (run 2026-09-23): desktop `clippy -D warnings` clean, `cargo test` 20/20,
`cargo check --target aarch64-linux-android` clean, `npm test`/`npm run build` clean, and
`cargo tauri android build --apk --target aarch64` produced a release APK (universal, under
`src-tauri/gen/android/app/build/outputs/apk/universal/release/`). The APK was NOT placed into
`Ready-made versions of applications/PlanWise`: this was a verification build, and the existing 0.1.15
artifacts there must not be overwritten by a same-version build with different content — a release
(version bump, signing, placement, device pass) is a separate decision. Device checks still pending:
reboot restore and cancellation of stale alarms.

Closed in the 23.09 batch: **N10** (digest content fingerprint), the TASK_COLUMNS contract test, and
the device pass below. Still open: the dual `core_base` copy (repo copy for CI vs `Modules/core_base`
locally) as a process risk, and the macOS artifacts lag (0.1.13 vs 0.1.16).

## Device pass 23.09.2026 — Pixel 7 Pro (Android 17), v0.1.16

Everything below was checked by running it on the device, not by reading the code:

| Check | Evidence |
|---|---|
| Digest fires in the configured hour | posted at 21:00:00 — "План на сегодня: 1 задача", summary "в течение дня" (`dumpsys notification`) |
| Digest pre-armed for tomorrow | AlarmManager alarm `2026-09-24 21:00:00`, RTC_WAKEUP, `window=0` (exact allowed) |
| N10: re-arm when the day's content changes | adding a task for tomorrow moved the TimedNotificationPublisher cancellation counter 3 -> 6 (`show()` cancels the previous alarm of the same id) |
| Reminder fires with the app backgrounded | "Напоминание" / "«TestRemindNow» — за 15 мин" at 21:10 = 21:25 - 15 min |
| Cancel sweep (task done -> day empty) | the digest alarm disappeared within one 60 s tick |
| Reboot restore | after `adb reboot` the process was started ONLY for `LocalNotificationRestoreReceiver` (0 activities) and the digest alarm was back |
| BACK minimizes | app went to the background, relaunch was warm |

Two P0 defects were found ONLY by this pass (both fixed in the same batch):

1. **`persistScheduled` never wrote anything.** `Invoke.parseArgs(BatchArgs::class.java)` runs jackson over the
   plugin's own arg classes, and the date produced by `time::serde::iso8601` is
   `+002026-09-24T19:00:00.000000000Z` — jackson's `SimpleDateFormat` pattern `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`
   cannot parse it, so the command was rejected and the error was swallowed by `let _ = ...` on the Rust side.
   Fix: Rust builds the whole JSON (`scheduled_json`, `js_date_utc`) and the bridge only stores the string;
   `persist_scheduled` now reads the store back and logs a mismatch.
2. **`pending()` is the wrong API, and `scheduledIds` first returned a map.** The Kotlin `getPending` returns
   `NotificationManager.activeNotifications` — notifications already in the shade — so the sync guard never
   blocked anything and the "cancel the extras" step cancelled nothing (it had never worked, in any build).
   Fix: read the persisted store through the bridge instead. The response must be a plain `ArrayList<Int>`:
   jackson serializes a `JSArray` as `{}`, and Rust reported `invalid type: map, expected a sequence`.

Found upstream (documented in PROJECT.md, not fixable here — the plugin's own code):
`Notification.sourceJson` is never assigned anywhere (so the plugin's `batch` stores the string "null");
`getSavedNotification` catches only `org.json.JSONException` while jackson throws `JsonProcessingException`
(a parse failure escapes the restore receiver); the restore path re-appends past-dated notifications with a
null `sourceJson`; `isUserUnlocked` early-returns during Direct Boot — on one of three reboots the alarm was
not yet restored ~20 s after boot (it was there on the next check, and the app re-arms on launch).

Residual limitation: a reminder restored after a reboot carries no `taskId` (`extra` is a `JSObject`, which
jackson cannot deserialize, so the entry must omit it) — the tap opens the app, not the task, until the next
launch re-schedules it.

Guards added in this batch: `persisted_json_matches_plugin_fields`, `js_date_is_plugin_format`,
`digest_action_reschedules_on_content_change`, `task_columns_match_schema` — 24 tests total.
