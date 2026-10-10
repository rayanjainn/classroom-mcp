CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE google_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE student_profile (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  data_enc TEXT NOT NULL
);

CREATE TABLE template_specs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT,
  spec TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  client_id TEXT,
  tool TEXT NOT NULL,
  args_redacted TEXT,
  status TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX audit_user_ts ON audit_log(user_id, ts DESC);

CREATE TABLE confirm_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  value TEXT NOT NULL,
  etag TEXT,
  expires_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE material_fts USING fts5(user_id UNINDEXED, course_id UNINDEXED, source_id UNINDEXED, title, body);
