# PlanWise 0.2.2 — deep audit and fix plan (11.10.2026)

Scope: the whole repo again, beyond `2026-09-22-deep-audit-plan.md` (N1–N29 there are closed; its
"refuted" list stays refuted). Gate on `main@4aeca9a`: clippy clean, `cargo test` 33/33, `tsc` clean,
`vite build` OK (main chunk 550 KB). The Android `cargo check --target aarch64-linux-android` from a plain
shell fails in cc-rs (sqlite3.c, NDK clang under sccache), which is an environment problem, not a code
defect (see O6). Nothing below has been fixed yet. The fixes wait for the owner's go-ahead.

Severity: **P0** wrong for every user every day · **P1** data loss or a broken feature · **P2** wrong in a
narrower case · **P3** hygiene / edge case. Effort: XS <10 lines · S one place + test · M several files ·
L a new layer.

## Errors — ranked, in fix order

| # | Sev | Effort | Where | Defect | Fix |
|---|-----|--------|-------|--------|-----|
| 1 | P0 | S | `notify.rs:1101-1158` | **Android digest arrives twice (0.2.2 regression).** After the hour, the first tick re-targets to tomorrow and overwrites `armed_day` (today → tomorrow, or → None on Cancel). The OS alarm's fire is never recorded in `sent_day`, so `digest_catchup_due` then sees "today not armed, not sent" and `show_digest_now` posts a second digest. This happens every day the process runs within `[hour, hour+6)`: it is alive, or the user opens the app that morning. | A pure `next_digest_state(old, new_armed, today, hour_passed)`: when the old `armed_day == Some(today)` and the hour has passed, carry `sent_day = Some(today)`. Add a unit test of the transition (the existing test covers only the predicate). |
| 2 | P1 | S | `notify.rs:441` | **Turning off both toggles doesn't stop Android notifications.** `tick` returns before `sync_scheduled`, so the cancel sweep never runs. The `Interval` digest re-arms itself in the OS forever, and reminders already scheduled (up to 7 days ahead) keep firing. With only one toggle off, cancellation works. | On Android, always call `sync_scheduled`. It already builds `expected` only from enabled features and cancels the rest. Keep the early return for desktop only. |
| 3 | P1 | XS | `src/autoSync.ts` `checkForImport` | **A local edit can be lost to auto-import.** `exporting` is set only while `doExport` runs, not during the 2 s debounce. If the minute check lands in that window and the folder holds a newer file from another device, `import_json` fully replaces the DB. The pending export then writes the replaced state, and the edit is gone on both devices. | `if (exporting \|\| exportTimer) return;`. Skip the check while an export is pending; the next minute tick imports. |
| 4 | P2 | S | `src/date.ts` `sortTasksByMode` | **Formula: "priority" sort is wrong for untimed tasks.** The key is `pr*1_000_000 + time` with `time = MAX_SAFE_INTEGER` for untimed tasks, so the time term outweighs priority. A *hard* task without a time sorts after every timed task, even *easy* ones. This also breaks the 2^53 precision guarantee. | Use the fallback `time = 1440` (one past the last minute of the day). Add a 3-case test (or assert) on the order. |
| 5 | P2 | S | `notify.rs` `check_digest` (~1237), `check_reminders` | **Desktop dedup is in memory only (`FIRED`).** Relaunching inside the digest window (+6 h) shows the digest again, and relaunching within `REMIND_CATCHUP_MINUTES` repeats reminders. | Digest: reuse the persisted `DigestState.sent_day` (it already exists for Android). Reminders: persist the last-fired timestamp, or accept the duplicates and document them (15 min window). |
| 6 | P2 | S | `commands.rs:1076-1104` `apply_import` | **Import can delete attachment files that old rows still use.** Files are written in place under their `stored_name` *before* commit. The same uuid names exist on both sides of an auto-sync, so this overwrites live files. If the transaction then fails, the rollback restores the old rows but `written` deletes the files they point to. A crash mid-write also corrupts a live file (non-atomic write). | Write to `<name>.tmp`, rename after a successful commit, and on error remove only the tmps. Skip the rewrite when the file exists with the same size (cheap, and it also speeds up sync). |
| 7 | P2 | M | Kotlin `WidgetData.toggle`, `QuickAddActivity` | **Widget actions bypass the scheduler while the process is dead.** Marking a task done from the widget leaves its OS reminders armed, so they fire for a done task. A timed task quick-added from the widget gets no reminder until the app is opened. With the process alive, the 60 s sync loop corrects both. | Minimal: after a toggle or quick-add, Kotlin starts a one-shot background sync (send a broadcast to the Rust side via the existing `WidgetPushPlugin` bridge, or post a `WorkManager` job that wakes the app process). Alternative: Rust writes `notify-ids.json` (taskId → ids) and Kotlin cancels them. Pick after a device check. |
| 8 | P2 | S/M | `notify.rs` `schedule_digest` (Interval) | **Stale digest content.** The repeating OS alarm carries the text from arm time. If the process never runs for days, every morning repeats the same day's list. | Cheap: put the date into the digest title ("Plan for 11 Oct"), so a stale list is recognisable. Full: a Kotlin receiver builds the text from SQLite at fire time (`WidgetData` already reads the DB) — L. |
| 9 | P3 | XS | `commands.rs:296` | `notify_minutes` is clamped to 43 200 (30 days), but the UI caps at 10 080 (168 h custom) and the scheduler horizon is 7 days. An imported value above 7 days is accepted and never fires. Not reachable from the UI. | Clamp to 10 080. |
| 10 | P3 | XS | `notify.rs:427,437,1237` | `widget_day()` / `fired()` `.lock().unwrap()`: one panic poisons the mutex and every later tick panics. The scheduler thread dies silently. | `unwrap_or_else(\|e\| e.into_inner())`, as `Db::lock` does. |
| 11 | P3 | S | `date.ts intervalsOverlap` + `commands.rs:306` | The overlap check ignores tasks crossing midnight (23:00 + 3 h vs 00:30 next day). TS and Rust agree, so there is no UI/backend drift. | Also check the previous day's tasks whose `start + dur > 1440`. Low value — document it if not fixing. |
| 12 | P3 | XS | `commands.rs` `restore_archived` | The overlap check runs for a restore whose target date is already past. It blocks the restore for no benefit. | Skip the check when `date < today`. |
| 13 | P3 | — | `duplicate_task_conn` | Duplicating a past-day task creates an undone copy on that past day. The next `archive_overdue` moves it to the archive at once, so the copy "disappears". | Product choice: duplicate onto today when the source is in the past. Ask the owner. |

## Formulas — verdict

- epoch-day: TS `toEpochDay`/`fromEpochDay`, Rust (`719_163` offset) and Kotlin (`UTC Calendar /
  86_400_000`) all key on the *local* Y-M-D. They are consistent and DST-safe. `dayWeight` rounds the
  local-midnight difference, which is also DST-safe.
- `intervalsOverlap` (TS) ≡ `check_time_overlap` (Rust): `[start, start+max(dur,1))` on both sides, and
  done/archived/someday are excluded on both sides. Correct (except the cross-midnight gap, #11).
- `taskTimeRange` (`+N days` via `floor(total/1440)`), `travelTimeText` (`((diff%1440)+1440)%1440`,
  "the evening before" when `diff<0`), `parseTimeToMinutes` bounds and `dueEpochLabel` buckets are
  correct.
- `sortSomedayTasks`: a stable sort, deadline first, mode order inside a deadline. Correct.
- **Wrong:** the priority sort key (#4).
- Rust notify math (`due_at`, DST resolution to the earlier instant, digest window, the
  `digest_catchup_due` predicate, Android horizon 7 d ≥ UI max 168 h) is correct. The defect is in the
  state transition around it (#1), not in the predicate.

## Optimisation / done badly / improvements

| # | Effort | Item |
|---|--------|------|
| O1 | M | Auto-sync shuttles the whole backup (base64 attachments included) through IPC twice: `read_sync_file` → JS → `import_json`, and `export_json` → JS → `write_sync_file`. Replace with two Rust commands, `sync_import(dir) -> Option<exportedAt>` and `sync_export(dir)`, so JS keeps only the timers. This removes the IPC copies and the JSON re-parse in the webview. |
| O2 | S | The main JS chunk grew 396 → 550 KB since 0.1.14. `i18n.ts` (3 739 lines, every language) is in it. Lazy-load the non-active locales with `import()`. |
| O3 | L | Auto-sync is whole-DB last-writer-wins (documented). Concurrent edits on two devices silently drop one side, and device clock skew can make a newer file look older. Tasks already carry `updated_at` + `device_id`, so a per-row merge plus deletion tombstones is the real upgrade. Product decision. |
| O4 | M | `AddTaskModal.tsx` (1 278 lines) and `SettingsPanel.tsx` (1 773) hold many inline `style={{…}}` blocks. They use tokens, so there is no hardcode, but they bypass `components.css`. Move the repeated select/field styles into classes when these files are next touched. Don't do it as a standalone sweep. |
| O5 | XS | Double locking in the delete commands (lock, release, re-lock for the widget refresh). Harmless at this scale; fold it into one guard when editing them. |
| O6 | XS | The gate's Android step is not reproducible from a plain shell (cc-rs needs the NDK `CC_aarch64_linux_android` / `AR_*` env). Record the working command in `PROJECT.md` (or use `cargo tauri android build --debug`, which sets the env). |
| O7 | — | Tests worth adding with the fixes: the digest state transition (#1), the tick with both toggles off (#2, pure part: `expected` is empty), the priority sort order (#4), and the import rollback keeping the old files (#6). |

## Order of work

1. #1 + #5 (one shared digest-state fix, test) → #2 → #3 → #4 — one release, all S/XS.
2. #6, #9, #10, #12 — data/hygiene batch.
3. #8 (cheap variant) and #7 (needs a device check) — Android batch, with a device verification.
4. O1, O2, O6. Then O3/#13 as owner decisions.

## Refuted / not defects (don't re-open)

- The UI can't set a reminder beyond the 7-day horizon (max preset 1 440, custom 168 h). #9 is
  import-only.
- The overlap rules are identical in TS and Rust; there is no drift.
- The 22.09 refuted list still stands (`move_task` someday branch, missing `tasks` field, `..`
  storedName, `core_base` path, `CONFLICT_REPLACE` in `WidgetData.kt`, no DB CHECK constraints).
- CSP / capabilities: the desktop has no fs rights, Android fs is scoped to user dirs, and the CSP
  has no remote origins. OK.
