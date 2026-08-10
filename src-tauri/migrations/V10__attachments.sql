-- Вложения заметок: файлы, прикреплённые к задаче (хранятся в
-- app_data_dir/files/attachments/, в БД — только метаданные и имя файла).
-- FK с каскадом: удаление задачи удаляет и её вложения (строки).
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  file_name TEXT NOT NULL,       -- оригинальное имя файла (для отображения)
  mime TEXT NOT NULL DEFAULT '', -- MIME-тип (для открытия системным приложением)
  size INTEGER NOT NULL DEFAULT 0,
  stored_name TEXT NOT NULL,     -- имя файла на диске (uuid + расширение)
  created_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
);

CREATE INDEX idx_attachments_task ON attachments (task_id);
