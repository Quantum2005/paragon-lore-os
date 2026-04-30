const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-ars40-user,x-ars40-role,x-ars40-user-id"
};

const ERROR_CODES = {
  BINDING_MISSING: "E_BINDING_MISSING",
  INVALID_FILENAME: "E_INVALID_FILENAME",
  FILE_NOT_FOUND: "E_FILE_NOT_FOUND",
  FILE_EXISTS: "E_FILE_EXISTS",
  INVALID_EXTERNAL_URL: "E_INVALID_EXTERNAL_URL",
  EXTERNAL_READONLY: "E_EXTERNAL_READONLY",
  FILE_LOCKED: "E_FILE_LOCKED",
  BAD_JSON: "E_BAD_JSON",
  UNSUPPORTED_ROUTE: "E_UNSUPPORTED_ROUTE",
  CHAT_BINDING_MISSING: "E_CHAT_BINDING_MISSING",
  CHAT_EMPTY_MESSAGE: "E_CHAT_EMPTY_MESSAGE",
  CHAT_MUTED: "E_CHAT_MUTED",
  CHAT_BANNED: "E_CHAT_BANNED",
  CHAT_PERMISSION_DENIED: "E_CHAT_PERMISSION_DENIED",
  CHAT_MESSAGE_NOT_FOUND: "E_CHAT_MESSAGE_NOT_FOUND",
  CHAT_INVALID_ACTION: "E_CHAT_INVALID_ACTION",
  CHAT_INVALID_CHANNEL: "E_CHAT_INVALID_CHANNEL"
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS
  }
});

const resolveArsDb = (env) => env?.ars40_db || env?.ARS40_DB || env?.db || null;
const resolveChatDb = (env) => env?.chat_db || env?.CHAT_DB || env?.db || null;

const ensureFileTable = async (database) => {
  await database.prepare(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      is_external INTEGER NOT NULL DEFAULT 0,
      external_url TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0,
      lock_password TEXT,
      created_by TEXT NOT NULL DEFAULT 'SYSTEM',
      updated_by TEXT NOT NULL DEFAULT 'SYSTEM',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await database.prepare("ALTER TABLE files ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
  await database.prepare("ALTER TABLE files ADD COLUMN lock_password TEXT").run().catch(() => {});
};

const normalizeFilename = (value) => String(value || "").trim();

const validateFilename = (value) => /^[a-zA-Z0-9._-]{1,80}$/.test(value);

const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const getActor = (request) => {
  const raw = request.headers.get("x-ars40-user") || "SYSTEM";
  return String(raw).trim().toUpperCase().slice(0, 40) || "SYSTEM";
};

const normalizeUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.toString();
  } catch {
    return "";
  }
};

const routeApi = async (request, env, pathname) => {
  const arsDb = resolveArsDb(env);
  if (!arsDb) {
    return json({ ok: false, code: ERROR_CODES.BINDING_MISSING, message: "D1 binding ars40_db is not configured." }, 500);
  }

  await ensureFileTable(arsDb);
  await ensureDemoFiles(arsDb);

  if (request.method === "GET" && pathname === "/api/files") {
    const rows = await arsDb.prepare(`
      SELECT filename, is_external, external_url, is_locked, updated_at
      FROM files
      ORDER BY filename COLLATE NOCASE ASC
    `).all();

    return json({ ok: true, files: rows.results || [] });
  }

  if (request.method === "GET" && pathname === "/api/file") {
    const url = new URL(request.url);
    const filename = normalizeFilename(url.searchParams.get("name"));
    const filePassword = String(url.searchParams.get("password") || "").trim();

    if (!validateFilename(filename)) {
      return json({ ok: false, code: ERROR_CODES.INVALID_FILENAME, message: "Invalid filename." }, 400);
    }

    const record = await arsDb.prepare(`
      SELECT filename, content, is_external, external_url, is_locked, lock_password, updated_at, updated_by
      FROM files
      WHERE filename = ?1
      LIMIT 1
    `).bind(filename).first();

    if (!record) {
      return json({ ok: false, code: ERROR_CODES.FILE_NOT_FOUND, message: "File not found." }, 404);
    }

    if (Number(record.is_locked) === 1 && filePassword !== String(record.lock_password || "")) {
      return json({ ok: false, code: ERROR_CODES.FILE_LOCKED, message: "File is locked and requires password." }, 403);
    }

    const { lock_password, ...safeRecord } = record;
    return json({ ok: true, file: safeRecord });
  }

  if (request.method === "POST" && pathname === "/api/file") {
    const body = await parseBody(request);
    if (!body) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Malformed JSON payload." }, 400);
    }
    const filename = normalizeFilename(body.filename);
    const actor = getActor(request);
    const mode = String(body.mode || "local").toLowerCase();
    const lockEnabled = Boolean(body.lock);
    const lockPassword = String(body.lockPassword || "");
    if (lockEnabled && !lockPassword) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Lock password required when lock is enabled." }, 400);
    }

    if (!validateFilename(filename)) {
      return json({ ok: false, code: ERROR_CODES.INVALID_FILENAME, message: "Filename must be 1-80 chars: a-z, A-Z, 0-9, dot, dash, underscore." }, 400);
    }

    const exists = await arsDb.prepare("SELECT id FROM files WHERE filename = ?1").bind(filename).first();
    if (exists) {
      return json({ ok: false, code: ERROR_CODES.FILE_EXISTS, message: "File already exists." }, 409);
    }

    if (mode === "external") {
      const externalUrl = normalizeUrl(body.externalUrl);
      if (!externalUrl) {
        return json({ ok: false, code: ERROR_CODES.INVALID_EXTERNAL_URL, message: "A valid external URL is required for external mode." }, 400);
      }

      await arsDb.prepare(`
        INSERT INTO files (filename, content, is_external, external_url, is_locked, lock_password, created_by, updated_by)
        VALUES (?1, '', 1, ?2, ?3, ?4, ?5, ?5)
      `).bind(filename, externalUrl, lockEnabled ? 1 : 0, lockEnabled ? lockPassword : null, actor).run();

      return json({ ok: true, message: `External link ${filename} created.`, file: { filename, is_external: 1, external_url: externalUrl, is_locked: lockEnabled ? 1 : 0 } });
    }

    const content = String(body.content || "");
    await arsDb.prepare(`
      INSERT INTO files (filename, content, is_external, external_url, is_locked, lock_password, created_by, updated_by)
      VALUES (?1, ?2, 0, NULL, ?3, ?4, ?5, ?5)
    `).bind(filename, content, lockEnabled ? 1 : 0, lockEnabled ? lockPassword : null, actor).run();

    return json({ ok: true, message: `File ${filename} created.`, file: { filename, is_external: 0, external_url: null, is_locked: lockEnabled ? 1 : 0 } });
  }

  if (request.method === "PUT" && pathname === "/api/file") {
    const body = await parseBody(request);
    if (!body) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Malformed JSON payload." }, 400);
    }
    const filename = normalizeFilename(body.filename);

    if (!validateFilename(filename)) {
      return json({ ok: false, code: ERROR_CODES.INVALID_FILENAME, message: "Invalid filename." }, 400);
    }

    const existing = await arsDb.prepare(`
      SELECT filename, is_external, is_locked, lock_password
      FROM files
      WHERE filename = ?1
      LIMIT 1
    `).bind(filename).first();

    if (!existing) {
      return json({ ok: false, code: ERROR_CODES.FILE_NOT_FOUND, message: "File not found." }, 404);
    }

    if (Number(existing.is_external) === 1) {
      return json({ ok: false, code: ERROR_CODES.EXTERNAL_READONLY, message: "External links cannot be edited locally." }, 409);
    }

    if (Number(existing.is_locked) === 1) {
      const suppliedPassword = String(body.lockPassword || "");
      if (suppliedPassword !== String(existing.lock_password || "")) {
        return json({ ok: false, code: ERROR_CODES.FILE_LOCKED, message: "File is locked and requires password." }, 403);
      }
    }

    const content = String(body.content || "");
    const actor = getActor(request);

    await arsDb.prepare(`
      UPDATE files
      SET content = ?2, updated_by = ?3, updated_at = datetime('now')
      WHERE filename = ?1
    `).bind(filename, content, actor).run();

    return json({ ok: true, message: `Saved ${filename}.` });
  }

  return json({ ok: false, code: ERROR_CODES.UNSUPPORTED_ROUTE, message: "Unsupported API route." }, 404);
};

const ensureAccountsTable = async (database) => {
  await database.prepare(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'standard',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
};

const sha256Hex = async (value) => {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
};


const ROLE_WEIGHT = { standard: 0, editor: 1, administrator: 2, manager: 3 };

const canModerateChat = (role) => Number(ROLE_WEIGHT[String(role || "standard").toLowerCase()] || 0) >= 2;

const ensureChatApiTables = async (database) => {
  await database.prepare(`
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
    )
  `).run();

  await database.prepare(`
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
    )
  `).run();
};

const cryptoRandomId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const upsertChatUser = async (database, username, role) => {
  await database.prepare(`
    INSERT INTO chat_users (username, role, updated_at)
    VALUES (?1, ?2, datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
      role = excluded.role,
      updated_at = datetime('now')
  `).bind(username, role).run();

  return database.prepare(`
    SELECT user_id, username, role, status, muted_until, banned_at
    FROM chat_users
    WHERE username = ?1
    LIMIT 1
  `).bind(username).first();
};

const routeChatApi = async (request, env, pathname) => {
  if (!env.chat_db) {
    return json({ ok: false, message: "D1 binding chat_db is not configured." }, 500);
  }

  await ensureChatApiTables(env.chat_db);

  if (request.method === "GET" && pathname === "/chat/api/messages") {
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") || 80);
    const limit = Math.min(200, Math.max(10, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 80));

    const rows = await env.chat_db.prepare(`
      SELECT id, message_uid, sender_user_id, sender_username, sender_role, content, metadata_json, channel, created_at
      FROM chat_messages
      WHERE is_deleted = 0
      ORDER BY id DESC
      LIMIT ?1
    `).bind(limit).all();

    const messages = (rows.results || []).reverse().map((row) => ({
      ...row,
      metadata: (() => {
        try { return JSON.parse(String(row.metadata_json || "{}")); } catch { return {}; }
      })()
    }));

    return json({ ok: true, messages });
  }

  if (request.method === "POST" && pathname === "/chat/api/messages") {
    const body = await parseBody(request);
    const actor = getActor(request);
    const actorRole = String(request.headers.get("x-ars40-role") || body?.senderRole || "standard").trim().toLowerCase();
    const content = String(body?.content || "").trim();
    if (!content || content.length > 2000) {
      return json({ ok: false, message: "Message content must be between 1 and 2000 characters." }, 400);
    }

    const user = await upsertChatUser(env.chat_db, actor, actorRole);
    if (String(user?.status || "active") === "banned" || user?.banned_at) {
      return json({ ok: false, code: "E_CHAT_BANNED", message: "You are banned from chat." }, 403);
    }
    if (user?.muted_until) {
      const mutedUntilMs = Date.parse(String(user.muted_until));
      if (!Number.isNaN(mutedUntilMs) && mutedUntilMs > Date.now()) {
        return json({ ok: false, code: "E_CHAT_MUTED", message: `Muted until ${user.muted_until}.` }, 403);
      }
    }

    const messageUid = cryptoRandomId();
    const metadata = JSON.stringify({ source: "ars40-chat", client: String(body?.client || "web") });

    await env.chat_db.prepare(`
      INSERT INTO chat_messages (message_uid, sender_user_id, sender_username, sender_role, content, metadata_json, channel, ip_hash)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(
      messageUid,
      user?.user_id || null,
      actor,
      actorRole,
      content,
      metadata,
      String(body?.channel || "global"),
      await sha256Hex(request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "")
    ).run();

    return json({ ok: true, message_uid: messageUid });
  }

  if (request.method === "DELETE" && /^\/chat\/api\/messages\/\d+$/.test(pathname)) {
    const role = String(request.headers.get("x-ars40-role") || "standard").trim().toLowerCase();
    const actor = getActor(request);
    if (!canModerateChat(role)) {
      return json({ ok: false, message: "Administrator role or higher required." }, 403);
    }

    const id = Number(pathname.split("/").pop());
    const found = await env.chat_db.prepare("SELECT id, sender_user_id, sender_username FROM chat_messages WHERE id = ?1 LIMIT 1").bind(id).first();
    if (!found) {
      return json({ ok: false, message: "Message not found." }, 404);
    }

    await env.chat_db.prepare("UPDATE chat_messages SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1").bind(id).run();
    await env.chat_db.prepare(`
      INSERT INTO chat_moderation_actions (action_type, target_user_id, target_username, target_message_id, reason, created_by, created_by_role)
      VALUES ('delete', ?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(found.sender_user_id || null, found.sender_username, id, "manual delete", actor, role).run();

    return json({ ok: true, deleted_message_id: id, target_user_id: found.sender_user_id, target_username: found.sender_username });
  }

  if (request.method === "POST" && pathname === "/chat/api/moderation") {
    const role = String(request.headers.get("x-ars40-role") || "standard").trim().toLowerCase();
    const actor = getActor(request);
    if (!canModerateChat(role)) {
      return json({ ok: false, message: "Administrator role or higher required." }, 403);
    }

    const body = await parseBody(request);
    const action = String(body?.action || "").trim().toLowerCase();
    const targetUserId = Number(body?.targetUserId);
    const reason = String(body?.reason || "").slice(0, 500);
    if (!["mute", "ban"].includes(action) || !Number.isInteger(targetUserId) || targetUserId <= 0) {
      return json({ ok: false, message: "Invalid moderation action payload." }, 400);
    }

    const target = await env.chat_db.prepare("SELECT user_id, username FROM chat_users WHERE user_id = ?1 LIMIT 1").bind(targetUserId).first();
    if (!target) {
      return json({ ok: false, message: "Target user not found." }, 404);
    }

    if (action === "mute") {
      const minutes = Math.min(7 * 24 * 60, Math.max(1, Number(body?.muteMinutes) || 30));
      await env.chat_db.prepare(`
        UPDATE chat_users
        SET muted_until = datetime('now', ?2), status = 'active', updated_at = datetime('now'), note = ?3
        WHERE user_id = ?1
      `).bind(targetUserId, `+${minutes} minutes`, reason || `Muted by ${actor}`).run();
      await env.chat_db.prepare(`
        INSERT INTO chat_moderation_actions (action_type, target_user_id, target_username, reason, created_by, created_by_role)
        VALUES ('mute', ?1, ?2, ?3, ?4, ?5)
      `).bind(target.user_id, target.username, reason || `Muted for ${minutes} minutes`, actor, role).run();
      return json({ ok: true, action: "mute", target_user_id: target.user_id, target_username: target.username, mute_minutes: minutes });
    }

    await env.chat_db.prepare(`
      UPDATE chat_users
      SET status = 'banned', banned_at = datetime('now'), muted_until = NULL, updated_at = datetime('now'), note = ?2
      WHERE user_id = ?1
    `).bind(targetUserId, reason || `Banned by ${actor}`).run();
    await env.chat_db.prepare(`
      INSERT INTO chat_moderation_actions (action_type, target_user_id, target_username, reason, created_by, created_by_role)
      VALUES ('ban', ?1, ?2, ?3, ?4, ?5)
    `).bind(target.user_id, target.username, reason || "Banned", actor, role).run();

    return json({ ok: true, action: "ban", target_user_id: target.user_id, target_username: target.username });
  }

  return json({ ok: false, message: "Unsupported chat route." }, 404);
};

const routeAuth = async (request, env, pathname) => {
  const arsDb = resolveArsDb(env);
  if (!arsDb) {
    return json({ ok: false, message: "D1 binding ars40_db is not configured." }, 500);
  }

  await ensureAccountsTable(arsDb);
  const body = await parseBody(request);

  if (request.method === "GET" && pathname === "/auth/debug") {
    const accountsCount = await arsDb.prepare("SELECT COUNT(*) AS count FROM accounts").first();
    const filesCount = await arsDb.prepare("SELECT COUNT(*) AS count FROM files").first().catch(() => ({ count: null }));
    return json({
      ok: true,
      service: "auth-debug",
      timestamp: new Date().toISOString(),
      db: {
        accounts: Number(accountsCount?.count || 0),
        files: filesCount?.count === null ? null : Number(filesCount?.count || 0)
      }
    });
  }

  if (request.method === "POST" && pathname === "/auth/login") {
    const username = String(body?.username || "").trim().toUpperCase();
    const password = String(body?.password || "");
    if (!username || !password) {
      return json({ ok: false, message: "Username and password are required." }, 400);
    }

    const account = await arsDb.prepare(`
      SELECT id, username, password_hash, role, enabled
      FROM accounts
      WHERE username = ?1
      LIMIT 1
    `).bind(username).first();

    if (!account) {
      return json({ ok: true, guest: true, role: "standard", username });
    }

    if (Number(account.enabled) !== 1) {
      return json({ ok: false, message: "Account disabled." }, 403);
    }

    const storedPassword = String(account.password_hash || "");
    const passwordSha = await sha256Hex(password);
    if (password !== storedPassword && passwordSha !== storedPassword) {
      return json({ ok: false, message: "Invalid credentials." }, 401);
    }

    return json({ ok: true, username: account.username, role: account.role || "standard" });
  }

  if (request.method === "POST" && pathname === "/auth/register") {
    const username = String(body?.username || "").trim().toUpperCase();
    const password = String(body?.password || "");

    if (!/^[A-Z0-9_-]{3,20}$/.test(username)) {
      return json({ ok: false, message: "Invalid username format." }, 400);
    }
    if (password.length < 4) {
      return json({ ok: false, message: "Password must be at least 4 characters." }, 400);
    }

    try {
      const insert = await arsDb.prepare(`
        INSERT INTO accounts (username, password_hash, role, enabled)
        VALUES (?1, ?2, 'standard', 1)
      `).bind(username, password).run();
      return json({ ok: true, id: insert.meta?.last_row_id || null, username, role: "standard" }, 201);
    } catch {
      return json({ ok: false, message: "Username already exists." }, 409);
    }
  }

  if (request.method === "POST" && pathname === "/auth/admin/update-username") {
    const id = Number(body?.id);
    const username = String(body?.username || "").trim().toUpperCase();
    if (!Number.isInteger(id) || id <= 0 || !/^[A-Z0-9_-]{3,20}$/.test(username)) {
      return json({ ok: false, message: "Invalid id or username." }, 400);
    }

    try {
      const result = await arsDb.prepare(`
        UPDATE accounts
        SET username = ?2, updated_at = datetime('now')
        WHERE id = ?1
      `).bind(id, username).run();
      if (!result.meta?.changes) {
        return json({ ok: false, message: "Account not found." }, 404);
      }
      return json({ ok: true, id, username });
    } catch {
      return json({ ok: false, message: "Username already exists." }, 409);
    }
  }

  if (request.method === "POST" && pathname === "/auth/admin/update-password") {
    const id = Number(body?.id);
    const password = String(body?.password || "");
    if (!Number.isInteger(id) || id <= 0 || password.length < 4) {
      return json({ ok: false, message: "Invalid id or password." }, 400);
    }

    const result = await arsDb.prepare(`
      UPDATE accounts
      SET password_hash = ?2, updated_at = datetime('now')
      WHERE id = ?1
    `).bind(id, password).run();
    if (!result.meta?.changes) {
      return json({ ok: false, message: "Account not found." }, 404);
    }
    return json({ ok: true, id });
  }

  if (request.method === "POST" && pathname === "/auth/admin/elevate") {
    const id = Number(body?.id);
    const requestedRole = String(body?.role || "").trim().toLowerCase();
    const actorRole = String(request.headers.get("x-ars40-role") || "standard").trim().toLowerCase();
    const allowedRoles = actorRole === "manager"
      ? ["administrator", "editor", "standard"]
      : actorRole === "administrator"
        ? ["editor", "standard"]
        : actorRole === "editor"
          ? ["standard"]
          : [];

    if (!allowedRoles.length) {
      return json({ ok: false, message: "Insufficient role for elevate." }, 403);
    }
    if (!Number.isInteger(id) || id <= 0 || !allowedRoles.includes(requestedRole)) {
      return json({ ok: false, message: `Invalid role. ${actorRole} may only elevate to ${allowedRoles.join(", ")}.` }, 400);
    }

    const result = await arsDb.prepare(`
      UPDATE accounts
      SET role = ?2, updated_at = datetime('now')
      WHERE id = ?1
    `).bind(id, requestedRole).run();
    if (!result.meta?.changes) {
      return json({ ok: false, message: "Account not found." }, 404);
    }
    return json({ ok: true, id, role: requestedRole });
  }

  return json({ ok: false, message: "Unsupported auth route." }, 404);
};

const CHAT_ROLE_LEVELS = {
  standard: 0,
  editor: 1,
  administrator: 2,
  manager: 3
};

const getRole = (request) => {
  const raw = String(request.headers.get("x-ars40-role") || "standard").trim().toLowerCase();
  return raw in CHAT_ROLE_LEVELS ? raw : "standard";
};

const ensureChatTables = async (database) => {
  await database.prepare(`
    CREATE TABLE IF NOT EXISTS relay_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_uid TEXT NOT NULL UNIQUE,
      sender TEXT NOT NULL,
      sender_account_id INTEGER,
      sender_role_snapshot TEXT NOT NULL DEFAULT 'standard',
      channel TEXT NOT NULL DEFAULT 'lobby',
      recipient TEXT,
      content TEXT NOT NULL,
      metadata_json TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_reason TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await database.prepare(`
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
    )
  `).run();

  await database.prepare(`
    CREATE TABLE IF NOT EXISTS relay_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      message_uid TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT,
      UNIQUE(username, message_uid)
    )
  `).run();

  await database.prepare(`
    CREATE TABLE IF NOT EXISTS relay_moderation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      target_username TEXT,
      target_message_uid TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await database.prepare(`
    CREATE TABLE IF NOT EXISTS relay_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persistent_user_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      role TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await database.prepare("ALTER TABLE relay_messages ADD COLUMN recipient TEXT").run().catch(() => {});
};

const requireModerator = (request) => {
  const role = getRole(request);
  if ((CHAT_ROLE_LEVELS[role] || 0) < CHAT_ROLE_LEVELS.administrator) {
    return false;
  }
  return true;
};

const routeChat = async (request, env, pathname) => {
  const chatDb = resolveChatDb(env);
  if (!chatDb) {
    return json({ ok: false, code: ERROR_CODES.CHAT_BINDING_MISSING, message: "D1 binding chat_db is not configured." }, 500);
  }

  await ensureChatTables(chatDb);

  if (request.method === "GET" && pathname === "/chat/messages") {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(250, Number(url.searchParams.get("limit") || 80)));
    const actor = getActor(request);
    const requestedChannel = String(url.searchParams.get("channel") || "lobby").trim();
    const dmPeer = requestedChannel.startsWith("@")
      ? requestedChannel.slice(1).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20)
      : "";

    let rows;
    if (dmPeer) {
      rows = await chatDb.prepare(`
        SELECT id, message_uid, sender, sender_account_id, sender_role_snapshot, channel, recipient, content, metadata_json, created_at
        FROM relay_messages
        WHERE is_deleted = 0
          AND channel = 'dm'
          AND ((sender = ?1 AND recipient = ?2) OR (sender = ?2 AND recipient = ?1))
        ORDER BY id DESC
        LIMIT ?3
      `).bind(actor, dmPeer, limit).all();
    } else {
      const channel = requestedChannel.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "lobby";
      rows = await chatDb.prepare(`
        SELECT id, message_uid, sender, sender_account_id, sender_role_snapshot, channel, recipient, content, metadata_json, created_at
        FROM relay_messages
        WHERE is_deleted = 0 AND channel = ?1
        ORDER BY id DESC
        LIMIT ?2
      `).bind(channel, limit).all();
    }

    const messages = (rows.results || []).reverse();
    return json({ ok: true, channel: dmPeer ? `@${dmPeer}` : requestedChannel || "lobby", messages });
  }

  if (request.method === "POST" && pathname === "/chat/messages") {
    const body = await parseBody(request);
    if (!body) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Malformed JSON payload." }, 400);
    }

    const sender = getActor(request);
    const senderRole = getRole(request);
    const persistentUserId = String(request.headers.get("x-ars40-user-id") || "").trim().toLowerCase().slice(0, 64);
    const content = String(body.content || "").trim();
    const requestedChannel = String(body.channel || "lobby").trim();
    const dmPeer = requestedChannel.startsWith("@")
      ? requestedChannel.slice(1).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20)
      : "";
    const channel = dmPeer ? "dm" : requestedChannel.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "lobby";
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;
    const blockedTerms = ["slur1", "slur2", "adminhack"];
    const mentionUsers = Array.from(new Set((content.match(/@([A-Z0-9_-]{3,20}|everyone|local)/gi) || [])
      .map((part) => part.slice(1).toUpperCase())));

    if (!channel) {
      return json({ ok: false, code: ERROR_CODES.CHAT_INVALID_CHANNEL, message: "Invalid channel." }, 400);
    }

    if (!content) {
      return json({ ok: false, code: ERROR_CODES.CHAT_EMPTY_MESSAGE, message: "Message content is required." }, 400);
    }

    let filteredContent = content;
    for (const term of blockedTerms) {
      filteredContent = filteredContent.replace(new RegExp(`\\b${term}\\b`, "gi"), (m) => "*".repeat(m.length));
    }
    if (persistentUserId) {
      await chatDb.prepare(`
        INSERT INTO relay_users (persistent_user_id, username, role, updated_at)
        VALUES (?1, ?2, ?3, datetime('now'))
        ON CONFLICT(persistent_user_id) DO UPDATE SET username = excluded.username, role = excluded.role, updated_at = datetime('now')
      `).bind(persistentUserId, sender, senderRole).run();
    }

    const flags = await chatDb.prepare(`
      SELECT is_muted, mute_expires_at, is_banned, ban_expires_at
      FROM relay_user_flags
      WHERE username = ?1
      LIMIT 1
    `).bind(sender).first();

    const nowIso = new Date().toISOString();
    const isMuted = Number(flags?.is_muted || 0) === 1 && (!flags?.mute_expires_at || String(flags.mute_expires_at) > nowIso);
    const isBanned = Number(flags?.is_banned || 0) === 1 && (!flags?.ban_expires_at || String(flags.ban_expires_at) > nowIso);

    if (isBanned) {
      return json({ ok: false, code: ERROR_CODES.CHAT_BANNED, message: "This account is banned from Relay." }, 403);
    }
    if (isMuted) {
      return json({ ok: false, code: ERROR_CODES.CHAT_MUTED, message: "This account is muted." }, 403);
    }

    const messageUid = crypto.randomUUID();
    await chatDb.prepare(`
      INSERT INTO relay_messages (message_uid, sender, sender_role_snapshot, channel, recipient, content, metadata_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind(messageUid, sender, senderRole, channel, dmPeer || null, filteredContent, metadata ? JSON.stringify(metadata) : null).run();

    const inboxTargets = new Set([...(dmPeer ? [dmPeer] : [])]);
    if (mentionUsers.includes("EVERYONE")) {
      const allUsers = await chatDb.prepare("SELECT DISTINCT username FROM relay_users").all();
      for (const r of (allUsers.results||[])) inboxTargets.add(String(r.username||"").toUpperCase());
    }
    if (mentionUsers.includes("LOCAL") && channel !== "dm") {
      const localUsers = await chatDb.prepare("SELECT DISTINCT sender FROM relay_messages WHERE channel = ?1").bind(channel).all();
      for (const r of (localUsers.results||[])) inboxTargets.add(String(r.sender||"").toUpperCase());
    }
    for (const u of mentionUsers.filter((u)=>u!=="EVERYONE"&&u!=="LOCAL")) inboxTargets.add(u);
    inboxTargets.delete(sender);
    for (const target of inboxTargets) {
      await chatDb.prepare(`
        INSERT INTO relay_inbox (username, message_uid, is_read)
        VALUES (?1, ?2, 0)
        ON CONFLICT(username, message_uid) DO NOTHING
      `).bind(target, messageUid).run();
    }

    return json({ ok: true, message_uid: messageUid });
  }

  if (request.method === "GET" && pathname === "/chat/inbox") {
    const actor = getActor(request);
    const url = new URL(request.url);
    const unreadOnly = String(url.searchParams.get("unread") || "1") !== "0";
    const rows = await chatDb.prepare(`
      SELECT i.message_uid, i.is_read, i.created_at AS inbox_created_at, m.sender, m.recipient, m.channel, m.content, m.created_at
      FROM relay_inbox i
      JOIN relay_messages m ON m.message_uid = i.message_uid
      WHERE i.username = ?1 AND m.is_deleted = 0 AND (?2 = 0 OR i.is_read = 0)
      ORDER BY i.created_at DESC
      LIMIT 250
    `).bind(actor, unreadOnly ? 1 : 0).all();

    return json({ ok: true, inbox: rows.results || [] });
  }

  if (request.method === "POST" && pathname === "/chat/inbox/read") {
    const actor = getActor(request);
    const body = await parseBody(request);
    const messageUids = Array.isArray(body?.messageUids) ? body.messageUids : [];
    if (!messageUids.length) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "messageUids array is required." }, 400);
    }

    for (const uid of messageUids.slice(0, 250)) {
      await chatDb.prepare(`
        UPDATE relay_inbox
        SET is_read = 1, read_at = datetime('now')
        WHERE username = ?1 AND message_uid = ?2
      `).bind(actor, String(uid)).run();
    }
    return json({ ok: true, count: messageUids.length });
  }

  if (request.method === "POST" && pathname === "/chat/moderation") {
    if (!requireModerator(request)) {
      return json({ ok: false, code: ERROR_CODES.CHAT_PERMISSION_DENIED, message: "Administrator rank or higher required." }, 403);
    }

    const body = await parseBody(request);
    if (!body) {
      return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Malformed JSON payload." }, 400);
    }

    const action = String(body.action || "").trim().toLowerCase();
    const actor = getActor(request);
    const actorRole = getRole(request);
    const reason = String(body.reason || "").trim().slice(0, 280) || null;

    if (action === "delete") {
      const messageUid = String(body.messageUid || "").trim();
      if (!messageUid) {
        return json({ ok: false, code: ERROR_CODES.CHAT_MESSAGE_NOT_FOUND, message: "Message ID is required." }, 400);
      }

      const existing = await chatDb.prepare(`
        SELECT message_uid
        FROM relay_messages
        WHERE message_uid = ?1 AND is_deleted = 0
        LIMIT 1
      `).bind(messageUid).first();

      if (!existing) {
        return json({ ok: false, code: ERROR_CODES.CHAT_MESSAGE_NOT_FOUND, message: "Message not found." }, 404);
      }

      await chatDb.prepare(`
        UPDATE relay_messages
        SET is_deleted = 1, deleted_reason = ?2, deleted_at = datetime('now'), deleted_by = ?3, updated_at = datetime('now')
        WHERE message_uid = ?1
      `).bind(messageUid, reason, actor).run();

      await chatDb.prepare(`
        INSERT INTO relay_moderation_log (action, actor, actor_role, target_message_uid, details_json)
        VALUES ('delete', ?1, ?2, ?3, ?4)
      `).bind(actor, actorRole, messageUid, JSON.stringify({ reason })).run();

      return json({ ok: true, action: "delete", message_uid: messageUid });
    }

    if (action === "mute" || action === "ban") {
      const targetUsername = String(body.targetUsername || "").trim().toUpperCase();
      if (!targetUsername) {
        return json({ ok: false, code: ERROR_CODES.BAD_JSON, message: "Target username is required." }, 400);
      }

      if (action === "mute") {
        await chatDb.prepare(`
          INSERT INTO relay_user_flags (username, is_muted, muted_reason, muted_by, muted_at, updated_at)
          VALUES (?1, 1, ?2, ?3, datetime('now'), datetime('now'))
          ON CONFLICT(username) DO UPDATE SET
            is_muted = 1,
            muted_reason = excluded.muted_reason,
            muted_by = excluded.muted_by,
            muted_at = datetime('now'),
            updated_at = datetime('now')
        `).bind(targetUsername, reason, actor).run();
      } else {
        await chatDb.prepare(`
          INSERT INTO relay_user_flags (username, is_banned, banned_reason, banned_by, banned_at, updated_at)
          VALUES (?1, 1, ?2, ?3, datetime('now'), datetime('now'))
          ON CONFLICT(username) DO UPDATE SET
            is_banned = 1,
            banned_reason = excluded.banned_reason,
            banned_by = excluded.banned_by,
            banned_at = datetime('now'),
            updated_at = datetime('now')
        `).bind(targetUsername, reason, actor).run();
      }

      await chatDb.prepare(`
        INSERT INTO relay_moderation_log (action, actor, actor_role, target_username, details_json)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(action, actor, actorRole, targetUsername, JSON.stringify({ reason })).run();

      return json({ ok: true, action, username: targetUsername });
    }

    return json({ ok: false, code: ERROR_CODES.CHAT_INVALID_ACTION, message: "Unknown moderation action." }, 400);
  }

  return json({ ok: false, code: ERROR_CODES.UNSUPPORTED_ROUTE, message: "Unsupported chat route." }, 404);
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return routeApi(request, env, url.pathname);
    }
    if (url.pathname.startsWith("/chat/api/")) {
      return routeChatApi(request, env, url.pathname);
    }
    if (url.pathname.startsWith("/auth/")) {
      return routeAuth(request, env, url.pathname);
    }
    if (url.pathname.startsWith("/chat/")) {
      return routeChat(request, env, url.pathname);
    }

    if (env.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Asset handler unavailable", { status: 500 });
  }
};
