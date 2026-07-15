CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date INTEGER NOT NULL,           -- epoch-day
    is_done INTEGER NOT NULL DEFAULT 0,
    color_set_id TEXT,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,     -- epoch-ms
    updated_at INTEGER NOT NULL,     -- epoch-ms
    device_id TEXT NOT NULL
);
CREATE INDEX idx_tasks_date ON tasks(date);

CREATE TABLE color_sets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color INTEGER NOT NULL,          -- ARGB
    sort_order REAL NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Дефолтные сеты цветов (ARGB-int = 0xFFRRGGBB)
-- cs-none    #F0ECE2 -> 4293979362
-- cs-work    #C9A87C -> 4291405948
-- cs-personal#7EB8C4 -> 4286494916
-- cs-sport   #E8A87C -> 4293437564
INSERT INTO color_sets (id, name, color, sort_order) VALUES
    ('cs-none', 'Без категории', 4293979362, 0.0),
    ('cs-work', 'Работа', 4291405948, 1.0),
    ('cs-personal', 'Личное', 4286494916, 2.0),
    ('cs-sport', 'Спорт', 4293437564, 3.0);
