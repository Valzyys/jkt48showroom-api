CREATE TABLE IF NOT EXISTS documents (
  database_name TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(database_name, collection_name, id)
);
CREATE INDEX IF NOT EXISTS documents_room ON documents(database_name, collection_name, json_extract(document, '$.room_id'));
CREATE INDEX IF NOT EXISTS documents_data ON documents(database_name, collection_name, json_extract(document, '$.data_id'));
CREATE INDEX IF NOT EXISTS documents_end ON documents(database_name, collection_name, json_extract(document, '$.live_info.date.end'));
CREATE TABLE IF NOT EXISTS cache_entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS cache_expiry ON cache_entries(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS beta_key_hash ON documents(json_extract(document, '$.keyHash')) WHERE database_name='liveDB' AND collection_name='betakeys';
CREATE UNIQUE INDEX IF NOT EXISTS beta_fingerprint ON documents(json_extract(document, '$.fingerprint')) WHERE database_name='liveDB' AND collection_name='allowedbetadevices';
CREATE UNIQUE INDEX IF NOT EXISTS member_slug ON documents(json_extract(document, '$.slug')) WHERE database_name='dcDB' AND collection_name='idolmembers';
CREATE UNIQUE INDEX IF NOT EXISTS showroom_room ON documents(json_extract(document, '$.room_id')) WHERE database_name='dcDB' AND collection_name='showrooms';
CREATE UNIQUE INDEX IF NOT EXISTS stats_key ON documents(json_extract(document, '$.type'), json_extract(document, '$.group'), json_extract(document, '$.month')) WHERE database_name='liveDB' AND collection_name='stats';
CREATE UNIQUE INDEX IF NOT EXISTS competition_snapshot ON documents(json_extract(document, '$.event_id'), json_extract(document, '$.snapshot_hour')) WHERE database_name='dcDB' AND collection_name='showroomcompetitions';
CREATE UNIQUE INDEX IF NOT EXISTS competition_fans_snapshot ON documents(json_extract(document, '$.event_id'), json_extract(document, '$.room_id'), json_extract(document, '$.snapshot_hour')) WHERE database_name='dcDB' AND collection_name='showroomcompetitiontopfans';
