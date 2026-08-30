-- Своё напоминание «до выезда»: NULL = не напоминать отдельно,
-- N = напомнить за N минут до момента выезда (start - travel_time).
ALTER TABLE tasks ADD COLUMN travel_notify_minutes INTEGER;
