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
