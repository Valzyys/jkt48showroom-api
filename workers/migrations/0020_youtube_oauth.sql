CREATE TABLE IF NOT EXISTS youtube_oauth_states (state_hash TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS youtube_oauth_credentials (id TEXT PRIMARY KEY, encrypted TEXT NOT NULL, channel_id TEXT NOT NULL, channel_title TEXT NOT NULL, version TEXT NOT NULL, updated_at INTEGER NOT NULL, received_at INTEGER);
