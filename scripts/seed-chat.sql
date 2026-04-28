CREATE TABLE IF NOT EXISTS chat_users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active',
  muted_until TEXT,
  banned_at TEXT,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_uid TEXT NOT NULL UNIQUE,
  sender_user_id INTEGER,
  sender_username TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'standard',
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  channel TEXT NOT NULL DEFAULT 'global',
  ip_hash TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(sender_user_id) REFERENCES chat_users(user_id)
);

CREATE TABLE IF NOT EXISTS chat_moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  target_user_id INTEGER,
  target_username TEXT,
  target_message_id INTEGER,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
