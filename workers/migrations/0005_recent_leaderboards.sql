CREATE TABLE IF NOT EXISTS collector_leaderboards (
 data_id TEXT PRIMARY KEY,
 source_version INTEGER NOT NULL,
 design_version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL,
 render_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 object_key TEXT,
 width INTEGER,
 height INTEGER,
 updated_at INTEGER NOT NULL,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS collector_leaderboards_state ON collector_leaderboards(state,lease_until);
