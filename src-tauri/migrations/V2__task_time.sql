-- Время задачи: минуты от полуночи (0-1439). NULL = «в течение дня».
ALTER TABLE tasks ADD COLUMN time_minutes INTEGER;
