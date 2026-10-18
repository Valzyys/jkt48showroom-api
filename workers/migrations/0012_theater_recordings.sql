CREATE TABLE IF NOT EXISTS collector_theater_recordings (
 id TEXT PRIMARY KEY, theater_code TEXT, document TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS theater_recordings_code ON collector_theater_recordings(theater_code,updated_at);
