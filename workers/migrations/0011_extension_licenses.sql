CREATE TABLE IF NOT EXISTS extension_licenses (
 id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, state TEXT NOT NULL,
 key_hash TEXT UNIQUE, key_hint TEXT, alias_cipher TEXT, provider_cipher TEXT,
 plan TEXT NOT NULL, email TEXT, duration_value INTEGER, duration_unit TEXT,
 max_activations INTEGER NOT NULL, expires_at TEXT, created_at INTEGER NOT NULL
);
