-- «Когда-нибудь»: задача без привязки ко дню (date игнорируется, = 0).
ALTER TABLE tasks ADD COLUMN someday INTEGER NOT NULL DEFAULT 0;
