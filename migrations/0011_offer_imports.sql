CREATE TABLE IF NOT EXISTS offer_publications (
  store_id TEXT PRIMARY KEY NOT NULL,
  source_hash TEXT NOT NULL,
  catalog_json TEXT NOT NULL,
  published_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS offer_import_runs (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'review', 'published', 'failed')),
  candidate_json TEXT NOT NULL DEFAULT '[]',
  offer_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS offer_import_runs_store_started
  ON offer_import_runs(store_id, started_at DESC);
