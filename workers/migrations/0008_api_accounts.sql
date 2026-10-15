CREATE TABLE IF NOT EXISTS api_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS api_sessions_account ON api_sessions(account_id);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  last4 TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  monthly_limit INTEGER NOT NULL,
  plan_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_keys_account ON api_keys(account_id);
CREATE TABLE IF NOT EXISTS api_key_usage (
  key_id TEXT NOT NULL,
  period TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, period)
);
CREATE TABLE IF NOT EXISTS api_usage_daily (
  key_id TEXT NOT NULL,
  day TEXT NOT NULL,
  route TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day, route)
);
CREATE INDEX IF NOT EXISTS api_usage_daily_day ON api_usage_daily(day);
CREATE TABLE IF NOT EXISTS api_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS api_request_log_account ON api_request_log(account_id, at);
CREATE INDEX IF NOT EXISTS api_request_log_at ON api_request_log(at);
CREATE TABLE IF NOT EXISTS api_vouchers (
  code_hash TEXT PRIMARY KEY,
  hint TEXT NOT NULL,
  requests INTEGER NOT NULL CHECK (requests > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by TEXT,
  redeemed_key TEXT
);
CREATE TABLE IF NOT EXISTS api_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  period TEXT NOT NULL,
  requests INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS api_topups_account ON api_topups(account_id, created_at);
CREATE TABLE IF NOT EXISTS api_payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  product TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_amount INTEGER,
  trx_id TEXT UNIQUE,
  payment_url TEXT,
  qr_image TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expired_at TEXT,
  created_at INTEGER NOT NULL,
  checked_at INTEGER,
  fulfilled_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_payments_account ON api_payments(account_id, created_at);
CREATE TABLE IF NOT EXISTS api_fanbase_applications (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  name TEXT NOT NULL,
  x_handle TEXT NOT NULL,
  listing INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS api_fanbase_account ON api_fanbase_applications(account_id, created_at);
CREATE INDEX IF NOT EXISTS api_fanbase_status ON api_fanbase_applications(status, created_at);
