-- Generated from accounts.json for Cloudflare D1 import
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'standard',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO accounts (username, password_hash, role, enabled) VALUES ('ADMIN', '5b40171489659251097e7790fc2f1892e2183a72546fe1df283d07865db9149c', 'administrator', 1) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, enabled=excluded.enabled;
INSERT INTO accounts (username, password_hash, role, enabled) VALUES ('OPERATOR', 'e60f04b7752601f35622b3d9d1aada4e988378f58a56c4f1e23b769c92941148', 'editor', 1) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, enabled=excluded.enabled;
INSERT INTO accounts (username, password_hash, role, enabled) VALUES ('GUEST', '4284a394a07bf90a540934ab02bd2e15d01867a7086d8ce18ba7ffeb6bc95273', 'standard', 1) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, enabled=excluded.enabled;
INSERT INTO accounts (username, password_hash, role, enabled) VALUES ('TEST', 'ecd71870d1963316a97e3ac3408c9835ad8cf0f3c1bc703527c30265534f75ae', 'standard', 1) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, enabled=excluded.enabled;
INSERT INTO accounts (username, password_hash, role, enabled) VALUES ('EGG', '34707c3f40dfa20c3902b807b627d420d6d474d9d98066ba637953d1cfd6b914', 'standard', 0) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, enabled=excluded.enabled;
