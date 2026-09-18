# PlanWise audit + fix plan (2026-09-18)

Branch: `perf/widget-write-debounce` (uncommitted WIP bugfix batch reviewed as part of the audit).

## Check status

- `cargo clippy --all-targets`, `cargo check`, `cargo test --lib` (16 tests): clean.
- `npm run build` (tsc + vite): clean; bundle 392 KB (120 KB gzip).
- `npm test`: **no such script** (PROJECT.md anchor says it exists) — gap, see #17.
- Two code-review passes (Rust backend, React frontend) over the full tree + WIP diff.

## Verified OK (no action)

- SQL: fully parameterized everywhere; import validates stored attachment names (no path traversal).
- WIP hunks: epoch_to_date round-trip (incl. pre-1970), digest tomorrow-scheduling (no duplicate alarms — single fixed id), archiveOverdue threshold matches Rust (`date < today-1`), AddTaskModal single-upsert with precomputed isDone, DayView conditional droppable pattern, month-nav day clamping, travel-time "накануне" wrap, MiniCalendar single-pass grouping.
- date.ts epoch conversions are DST-safe.

## Findings (ranked)

### P1 — fix first

1. **SECURITY — arbitrary file read/write from the webview.** `read_sync_file` / `write_sync_file` (src-tauri/src/commands.rs:832,839) accept any absolute path from the frontend and do raw `std::fs` I/O; a XSS'd webview can read/overwrite arbitrary user files. Fix: pin to a fixed app directory or verify the path belongs to the parent dir chosen via dialog.
2. **Desktop digest silently disabled for hour ≥ 14.** `check_digest` (src-tauri/src/notify.rs:693) hardcodes window end `now.hour() >= 14`; users with day_summary_hour 14–23 never get the digest. Fix: derive the window from the configured hour.
3. **"Перейти к этому дню" from search is a no-op.** App.tsx:657 — `onJumpToDay` sets date/view but `searchActive` stays true, SearchResults keeps replacing the view. Fix: reset search inside `onJumpToDay`.

### P2 — correctness edge cases

4. **Widget day-change stamp written before the widget write.** notify.rs:320-330 — `*last = today` before `refresh_widget`; a failed write leaves the widget stale for a full day. Fix: commit the stamp only on Ok.
5. **TOCTOU in check-then-insert.** `upsert_task` (commands.rs:126-157), `move_task` (297-325), `restore_archived` (475-493) — overlap check and write are two separate lock scopes; concurrent saves can both pass. Fix: one lock/transaction covering check+write.
6. **Someday tasks rendered as "past" in search results.** SearchResults.tsx:157-158,201 — `isPast(fromEpochDay(0))` → 1970 → all "Когда-нибудь" hits styled muted/expired. Fix: base `past` on dueEpochDay for someday tasks.

### P3 — perf / robustness / hygiene

7. Android digest rescheduled on every 60 s tick without a `pending_ids` guard (notify.rs:617-623) — works only due to plugin's FLAG_UPDATE_CURRENT semantics; add the same guard as the reminders branch.
8. Dead `ALLOW_EXIT` machinery + stale comments after WIP removal of the `ExitRequested` guard (lib.rs:145-176, commands.rs:821-823). Verified removal itself is safe (CloseRequested still hides the window; exit_app/Cmd+Q now both exit). Delete the flag, fix comments.
9. `add_attachment` holds the global DB mutex across a ≤25 MB disk write (commands.rs:1205-1217) — stalls all other commands. Fix: write file before locking.
10. `refresh_widget` runs 23 separate queries per write; `week` (0..7) is a strict subset of `dayWindow` (-1..=13) — 7 duplicate queries (commands.rs:998-1023). Fix: slice week out of day_window, reuse one statement.
11. autoSync race: the minute-tick can import the app's own just-written file in the window between `write_sync_file` and `setAutoSyncLastAt` (src/autoSync.ts:59-103). Fix: in-flight export flag or record exportedAt before the write. Note: the WIP `parseExportedAt` regex hack is worse than the original `JSON.parse` (brittle position assumption) — revert it and fix the real race instead.
12. App.tsx:81-111 `useStore()` without selector — full-store subscription re-renders the whole tree on every change (subtaskRev bumps, uiScale slider). Fix: individual primitive selectors.
13. TaskCard conflictId selector scans all tasks per card per store change → O(cards×tasks) (src/components/TaskCard.tsx:148-162). Fix: precompute a per-day conflict map.
14. `confirmPromote` in drag.tsx:264-280 — two non-atomic awaits, no try/catch: failure between them duplicates data and rejects unhandled.
15. Inline add/toggle handlers without error handling (SubtaskList.tsx:28-39, DayView.tsx:48, WeekViewVertical.tsx:50, DayColumn.tsx:53, SomedayColumn.tsx:192) — failed invokes are silent unhandled rejections. Route through showToast.
16. Browser fallback `upsertTask` never stamps `updatedAt` (api-browser-fallback.ts:43-50) — archive sorting diverges from Rust backend.
17. `npm test` missing from package.json while PROJECT.md and CI reference a test gate — add a script (e.g. tsc --noEmit as floor) or fix the anchor/CI.

## Ponytail (over-engineering) findings

- `delete:` dead `ALLOW_EXIT`/`request_exit` machinery (see #8). [src-tauri/src/lib.rs, commands.rs]
- `delete:` 7 duplicate week queries in refresh_widget (see #10). [src-tauri/src/commands.rs]
- `shrink:` WIP `parseExportedAt` regex pre-scan → revert to plain `JSON.parse` (see #11). [src/autoSync.ts]
- Otherwise lean: no speculative abstractions found; shared logic already lives in `core_base` (diagnostics).

## Android cold start (measured on device, Pixel 7 Pro, Android 17, 0.1.13 installed)

- `am start -W` after force-stop, 3 runs: TotalTime **821 / 649 / 489 ms** to first frame (themed splash) — consistent with the 0.1.13 baseline (534–565 ms in PROJECT.md).
- Startup anatomy (logcat): process spawn + libdaily_planner_lib.so ≈ 0.5 s → first frame 525 ms → WebView (Vanadium 153) init and content load after Displayed; user-perceived time to usable UI ≈ 1.5–2 s. Platform-bound (WebView/libmonochrome init), app-side setup already backgrounded (attachment sweep, notification permission — both spawn).
- "Не всегда запускается с 1-го раза": **not reproducible via adb** — 10 cold launches all Status: ok; dropbox and the crash log buffer are empty (device uptime 2h11m). Release build is not debuggable, so app-side diagnostic logs are unreadable on-device.
- Hypotheses: (a) perception — splash/first-frame is fine but WebView content paints up to ~2 s later on a truly cold start, user retaps; (b) icon tap while the process is already being spawned in the background by the 15-min widget alarm; (c) WebView provider (Vanadium) first-init slowness.
- Plan: add startup milestones to the existing `core_base::diagnostics` ring ("activity onCreate", "webview loaded", "tasks rendered") + ship one debuggable instrumentation build; the next occurrence then distinguishes "process never started" (no "старт" record → OS/launcher) from "process started but stuck" (records stop at a milestone → app). Also consider enabling `webviewContentsDebuggingEnabled` in a debug variant.

## Suggested fix order

1. #1 (SECURITY) → 2. #2, #3 (user-visible) → 3. #4-#6 (data edge cases) → 4. #8, #11 (revert WIP regression + dead code) → 5. #7, #9, #10, #12-#16 (perf/robustness) → 6. #17 (hygiene) → 7. cold-start instrumentation.
