CREATE TABLE IF NOT EXISTS collector_recent_youtube (
  data_id TEXT NOT NULL,
  run TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(data_id,run)
);
