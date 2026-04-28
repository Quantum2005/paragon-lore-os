CREATE TABLE IF NOT EXISTS relay_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_uid TEXT NOT NULL UNIQUE,
  sender TEXT NOT NULL,
  sender_account_id INTEGER,
  sender_role_snapshot TEXT NOT NULL DEFAULT 'standard',
  channel TEXT NOT NULL DEFAULT 'lobby',
  content TEXT NOT NULL,
  metadata_json TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_reason TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relay_user_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  is_muted INTEGER NOT NULL DEFAULT 0,
  muted_reason TEXT,
  muted_by TEXT,
  muted_at TEXT,
  mute_expires_at TEXT,
  is_banned INTEGER NOT NULL DEFAULT 0,
  banned_reason TEXT,
  banned_by TEXT,
  banned_at TEXT,
  ban_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relay_moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  target_username TEXT,
  target_message_uid TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
