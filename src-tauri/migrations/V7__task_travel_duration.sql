-- Время в пути (выезд заранее) и длительность выполнения задачи.
ALTER TABLE tasks ADD COLUMN travel_time INTEGER;
ALTER TABLE tasks ADD COLUMN duration_minutes INTEGER;
