-- Заметка к задаче. '' = нет заметки.
ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';
