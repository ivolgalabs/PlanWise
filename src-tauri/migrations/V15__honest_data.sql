-- Honest data for the "plan -> do -> close the day" cycle.
-- done_at: when the task was closed; dropped_at: closed as "let go" (is_done = 1
-- too, so widgets, reminders and overlap checks treat it as not open);
-- postpone_count: moves from today/past to a future day (move_task).
ALTER TABLE tasks ADD COLUMN done_at INTEGER;
ALTER TABLE tasks ADD COLUMN dropped_at INTEGER;
ALTER TABLE tasks ADD COLUMN postpone_count INTEGER NOT NULL DEFAULT 0;

-- Best estimate for tasks closed before V15: their last edit.
UPDATE tasks SET done_at = updated_at WHERE is_done = 1;

-- done_at/dropped_at are owned by the DB: every writer (commands, import,
-- Android widgets) toggles is_done, the triggers keep the timestamps honest.
CREATE TRIGGER tasks_done_at_update AFTER UPDATE OF is_done ON tasks
WHEN NEW.is_done IS NOT OLD.is_done
BEGIN
  UPDATE tasks SET
    done_at = CASE NEW.is_done WHEN 1 THEN CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) END,
    dropped_at = CASE NEW.is_done WHEN 1 THEN dropped_at END
  WHERE id = NEW.id;
END;

CREATE TRIGGER tasks_done_at_insert AFTER INSERT ON tasks
WHEN NEW.is_done = 1 AND NEW.done_at IS NULL
BEGIN
  UPDATE tasks SET done_at = NEW.updated_at WHERE id = NEW.id;
END;

-- A day as a page: closed_at = the day was reviewed, note = "how it went".
CREATE TABLE days (
  epoch_day INTEGER PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  closed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
