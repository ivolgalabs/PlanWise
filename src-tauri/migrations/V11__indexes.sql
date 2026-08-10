-- Индексы для частых фильтров: «Когда-нибудь» (someday=1 AND archived=0),
-- «Архив» (archived=1) и выборка по датам (день/неделя/месяц, виджет,
-- напоминания). При масштабе личного планировщика полные сканы незаметны,
-- но индексы дёшевы, а выборки по дате и так на каждом старте/тике.
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks (date);
CREATE INDEX IF NOT EXISTS idx_tasks_someday_archived ON tasks (someday, archived);
