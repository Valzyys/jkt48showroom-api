CREATE TABLE IF NOT EXISTS collector_live_notices (
 data_id TEXT PRIMARY KEY, source_version TEXT NOT NULL, snapshot TEXT NOT NULL,
 is_live INTEGER NOT NULL DEFAULT 0, is_preview INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collector_live_notice_images (
 data_id TEXT NOT NULL, theme TEXT NOT NULL, layout TEXT NOT NULL, source_version TEXT NOT NULL,
 state TEXT NOT NULL, render_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 object_key TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(data_id,theme,layout)
);
CREATE INDEX IF NOT EXISTS live_notice_active ON collector_live_notices(is_live,updated_at);
