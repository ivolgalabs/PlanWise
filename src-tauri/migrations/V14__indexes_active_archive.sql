-- Индексы под реальные запросы, которых не было в V11: список «Архива»
-- (archived = 1, сортировка по дате и updated_at) и активные задачи дня
-- (напоминания, виджет). На личных объёмах это незаметно, но выборки идут
-- на каждом старте, тике планировщика и обновлении виджета.
CREATE INDEX IF NOT EXISTS idx_tasks_archived_date ON tasks (archived, date DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_date_active ON tasks (date, is_done, archived, someday);
