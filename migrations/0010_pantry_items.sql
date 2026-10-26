CREATE TABLE IF NOT EXISTS pantry_items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  amount TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  section_code TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS pantry_items_position ON pantry_items(position, name);
