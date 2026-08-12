export const schema = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('Image', 'Audio', 'Video')),
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '[]',
  conversion_status TEXT NOT NULL DEFAULT 'ready',
  conversion_progress INTEGER NOT NULL DEFAULT 100,
  conversion_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_project_kind ON assets(project_id, kind);

CREATE TABLE IF NOT EXISTS localization_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audioLocalization', 'textLocalization')),
  key TEXT NOT NULL,
  values_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, kind, key)
);

CREATE INDEX IF NOT EXISTS idx_localization_project_kind ON localization_entries(project_id, kind);

CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  asset_token TEXT NOT NULL,
  gpt_api_token TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT 'readonly',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_project_created ON audit_logs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  api_token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'readonly' CHECK (role IN ('admin', 'manager', 'readonly')),
  enabled INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;
