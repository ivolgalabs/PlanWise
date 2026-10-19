-- Repeating tasks: NULL | 'daily' | 'weekly' | 'monthly'. Completing a task with
-- a repeat spawns the next occurrence (upsert_task); dropping it ends the series.
ALTER TABLE tasks ADD COLUMN repeat TEXT;
