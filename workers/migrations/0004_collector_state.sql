CREATE TABLE IF NOT EXISTS collector_state (
 name TEXT PRIMARY KEY,
 value TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_video_uploads (
 id TEXT PRIMARY KEY,
 data_id TEXT NOT NULL,
 run TEXT NOT NULL,
 object_key TEXT NOT NULL,
 upload_id TEXT NOT NULL,
 parts TEXT NOT NULL DEFAULT '{}',
 updated_at INTEGER NOT NULL
);
