-- «Архив»: задача скрыта из видов, ждёт возврата (archived = 1).
ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
